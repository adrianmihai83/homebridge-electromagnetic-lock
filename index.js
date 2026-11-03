"use strict";

const PLUGIN_NAME = "homebridge-electromagnetic-lock";
const PLATFORM_NAME = "ElectromagneticLock";
const PLUGIN_VERSION = "2.0.2";

const STATE_UNSECURED = 0;
const STATE_SECURED = 1;
const STATE_JAMMED = 2;

function withDefaults(config = {}) {
  return {
    activeLow: true,
    unlockingDuration: 2,
    gpioChip: 0,
    ...config,
  };
}

function validateConfig(config) {
  const errors = [];

  if (typeof config.name !== "string" || config.name.trim() === "") {
    errors.push("name must be a non-empty string");
  }
  if (!Number.isInteger(config.lockPin) || config.lockPin < 0) {
    errors.push("lockPin must be a non-negative integer BCM GPIO line number");
  }
  if (!Number.isInteger(config.gpioChip) || config.gpioChip < 0) {
    errors.push("gpioChip must be a non-negative integer");
  }
  if (typeof config.activeLow !== "boolean") {
    errors.push("activeLow must be true or false");
  }
  if (!Number.isInteger(config.unlockingDuration) || config.unlockingDuration < 1 || config.unlockingDuration > 3600) {
    errors.push("unlockingDuration must be an integer between 1 and 3600 seconds");
  }

  return errors;
}

function logMessage(log, level, message) {
  if (log && typeof log[level] === "function") {
    log[level](message);
  } else if (typeof log === "function") {
    log(message);
  }
}

class LockController {
  constructor(log, config, api, service) {
    this.log = log;
    this.config = withDefaults(config);
    this.api = api;
    this.Characteristic = api.hap.Characteristic;
    this.service = service;
    this.currentState = STATE_SECURED;
    this.targetState = STATE_SECURED;
    this.unlockTimeout = undefined;
    this.lockLine = undefined;
    this.gpioChip = undefined;
    this.gpioError = undefined;

    this.service
      .getCharacteristic(this.Characteristic.LockCurrentState)
      .onGet(() => this.currentState);

    this.service
      .getCharacteristic(this.Characteristic.LockTargetState)
      .onGet(() => this.targetState)
      .onSet((state) => this.setTargetState(Number(state)));

    this.setState(STATE_SECURED, STATE_SECURED);
    this.initializeGpio();
  }

  initializeGpio() {
    try {
      // Load the native dependency only for a configured lock. This lets
      // Homebridge inspect or disable the plugin on unsupported systems.
      const Gpio = require("node-libgpiod");
      this.gpioChip = new Gpio.Chip(this.config.gpioChip);
      this.lockLine = new Gpio.Line(this.gpioChip, this.config.lockPin);

      // Supplying the secure value as the initial output prevents an
      // active-low relay from receiving a short unlock pulse at startup.
      this.lockLine.requestOutputMode(PLUGIN_NAME, this.securedPinValue());
      this.gpioError = undefined;
      logMessage(
        this.log,
        "info",
        `Configured ${this.config.name} on gpiochip${this.config.gpioChip} line ${this.config.lockPin} in the secured state.`,
      );
    } catch (error) {
      this.gpioError = error instanceof Error ? error : new Error(String(error));
      this.setState(STATE_JAMMED, STATE_SECURED);
      logMessage(this.log, "error", `Unable to initialise GPIO for ${this.config.name}: ${this.gpioError.message}`);
    }
  }

  securedPinValue() {
    return this.config.activeLow ? 1 : 0;
  }

  unsecuredPinValue() {
    return this.config.activeLow ? 0 : 1;
  }

  ensureGpio() {
    if (this.gpioError) {
      throw this.gpioError;
    }
    if (!this.lockLine) {
      throw new Error("GPIO line is not available");
    }
  }

  writePin(value) {
    this.ensureGpio();
    this.lockLine.setValue(value);
  }

  setState(currentState, targetState) {
    this.currentState = currentState;
    this.targetState = targetState;
    this.service.updateCharacteristic(this.Characteristic.LockCurrentState, currentState);
    this.service.updateCharacteristic(this.Characteristic.LockTargetState, targetState);
  }

  async setTargetState(state) {
    if (state === STATE_SECURED) {
      this.cancelAutoRelock();
      this.secureLock();
      return;
    }

    if (state !== STATE_UNSECURED) {
      throw new Error(`Unsupported lock target state: ${state}`);
    }

    this.cancelAutoRelock();
    try {
      this.writePin(this.unsecuredPinValue());
      this.setState(STATE_UNSECURED, STATE_UNSECURED);
      logMessage(this.log, "info", `${this.config.name} unlocked for ${this.config.unlockingDuration} seconds.`);
    } catch (error) {
      this.setState(STATE_JAMMED, STATE_SECURED);
      throw error;
    }

    this.unlockTimeout = setTimeout(() => {
      try {
        this.secureLock();
      } catch (error) {
        this.setState(STATE_JAMMED, STATE_SECURED);
        logMessage(this.log, "error", `Unable to re-secure ${this.config.name}: ${error.message}`);
      }
    }, this.config.unlockingDuration * 1000);
    this.unlockTimeout.unref?.();
  }

  secureLock() {
    try {
      this.writePin(this.securedPinValue());
      this.setState(STATE_SECURED, STATE_SECURED);
      logMessage(this.log, "info", `${this.config.name} secured.`);
    } catch (error) {
      this.setState(STATE_JAMMED, STATE_SECURED);
      throw error;
    }
  }

  cancelAutoRelock() {
    if (this.unlockTimeout) {
      clearTimeout(this.unlockTimeout);
      this.unlockTimeout = undefined;
    }
  }

  shutdown() {
    this.cancelAutoRelock();
    if (!this.lockLine) {
      return;
    }

    try {
      this.lockLine.setValue(this.securedPinValue());
    } catch (error) {
      logMessage(this.log, "error", `Unable to set ${this.config.name} to its secure shutdown state: ${error.message}`);
    }

    try {
      this.lockLine.release();
    } catch (error) {
      logMessage(this.log, "warn", `Unable to release GPIO for ${this.config.name}: ${error.message}`);
    }
    this.lockLine = undefined;
  }
}

class ElectromagneticLockPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = withDefaults(config);
    this.api = api;
    this.cachedAccessories = [];
    this.controller = undefined;

    const errors = validateConfig(this.config);
    if (errors.length > 0) {
      logMessage(this.log, "error", `Invalid configuration: ${errors.join("; ")}.`);
      return;
    }

    this.api.on("didFinishLaunching", () => this.discoverLock());
    this.api.on("shutdown", () => this.controller?.shutdown());
  }

  configureAccessory(accessory) {
    this.cachedAccessories.push(accessory);
  }

  discoverLock() {
    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${this.config.name}`);
    let accessory = this.cachedAccessories.find((candidate) => candidate.UUID === uuid);
    const staleAccessories = this.cachedAccessories.filter((candidate) => candidate.UUID !== uuid);

    if (staleAccessories.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
    }

    if (!accessory) {
      accessory = new this.api.platformAccessory(this.config.name, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    accessory.context.device = {
      name: this.config.name,
      lockPin: this.config.lockPin,
      gpioChip: this.config.gpioChip,
      activeLow: this.config.activeLow,
      unlockingDuration: this.config.unlockingDuration,
    };

    const { Service, Characteristic } = this.api.hap;
    const informationService = accessory.getService(Service.AccessoryInformation);
    informationService
      .setCharacteristic(Characteristic.Manufacturer, "adrianmihai83")
      .setCharacteristic(Characteristic.Model, "Raspberry Pi GPIO Electromagnetic Lock")
      .setCharacteristic(Characteristic.SerialNumber, `${this.config.gpioChip}-${this.config.lockPin}`)
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    const lockService = accessory.getService(Service.LockMechanism)
      || accessory.addService(Service.LockMechanism, this.config.name);
    this.controller = new LockController(this.log, this.config, this.api, lockService);
    this.api.updatePlatformAccessories([accessory]);
  }
}

function createLegacyAccessory(api) {
  return class ElectromagneticLockLegacyAccessory {
    constructor(log, config) {
      this.log = log;
      this.config = withDefaults(config);
      const errors = validateConfig(this.config);
      if (errors.length > 0) {
        throw new Error(`Invalid ElectromagneticLock configuration: ${errors.join("; ")}`);
      }

      const { Service, Characteristic } = api.hap;
      this.lockService = new Service.LockMechanism(this.config.name);
      this.informationService = new Service.AccessoryInformation();
      this.informationService
        .setCharacteristic(Characteristic.Manufacturer, "adrianmihai83")
        .setCharacteristic(Characteristic.Model, "Raspberry Pi GPIO Electromagnetic Lock")
        .setCharacteristic(Characteristic.SerialNumber, `${this.config.gpioChip}-${this.config.lockPin}`)
        .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);
      this.controller = new LockController(log, this.config, api, this.lockService);
      api.on("shutdown", () => this.controller.shutdown());
    }

    getServices() {
      return [this.informationService, this.lockService];
    }
  };
}

module.exports = function initialisePlugin(api) {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, ElectromagneticLockPlatform);
  // Backward compatibility for v1/v2 configurations. New installations use
  // the dynamic platform declared in config.schema.json.
  api.registerAccessory(PLUGIN_NAME, PLATFORM_NAME, createLegacyAccessory(api));
};

module.exports.constants = {
  PLUGIN_NAME,
  PLATFORM_NAME,
  STATE_UNSECURED,
  STATE_SECURED,
  STATE_JAMMED,
};
