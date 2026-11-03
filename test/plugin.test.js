"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const test = require("node:test");

const gpioOperations = [];

class FakeChip {
  constructor(number) {
    this.number = number;
    gpioOperations.push(["chip", number]);
  }
}

class FakeLine {
  constructor(chip, pin) {
    this.chip = chip;
    this.pin = pin;
    gpioOperations.push(["line", chip.number, pin]);
  }

  requestOutputMode(consumer, initialValue) {
    gpioOperations.push(["requestOutputMode", consumer, initialValue]);
  }

  setValue(value) {
    gpioOperations.push(["setValue", value]);
  }

  release() {
    gpioOperations.push(["release"]);
  }
}

const originalLoad = Module._load;
Module._load = function mockNativeGpio(request, parent, isMain) {
  if (request === "node-libgpiod") {
    return { Chip: FakeChip, Line: FakeLine };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const initialisePlugin = require("../index.js");

const Characteristic = {
  LockCurrentState: "LockCurrentState",
  LockTargetState: "LockTargetState",
  Manufacturer: "Manufacturer",
  Model: "Model",
  SerialNumber: "SerialNumber",
  FirmwareRevision: "FirmwareRevision",
};

class FakeCharacteristic {
  constructor() {
    this.value = undefined;
    this.getter = undefined;
    this.setter = undefined;
  }

  onGet(handler) {
    this.getter = handler;
    return this;
  }

  onSet(handler) {
    this.setter = handler;
    return this;
  }
}

class FakeService {
  constructor(name = "") {
    this.displayName = name;
    this.characteristics = new Map();
  }

  getCharacteristic(characteristic) {
    if (!this.characteristics.has(characteristic)) {
      this.characteristics.set(characteristic, new FakeCharacteristic());
    }
    return this.characteristics.get(characteristic);
  }

  updateCharacteristic(characteristic, value) {
    this.getCharacteristic(characteristic).value = value;
    return this;
  }

  setCharacteristic(characteristic, value) {
    return this.updateCharacteristic(characteristic, value);
  }
}

class LockMechanism extends FakeService {}
class AccessoryInformation extends FakeService {}

const Service = { LockMechanism, AccessoryInformation };

class FakePlatformAccessory {
  constructor(name, uuid) {
    this.displayName = name;
    this.UUID = uuid;
    this.context = {};
    this.services = [new AccessoryInformation()];
  }

  getService(ServiceType) {
    return this.services.find((service) => service instanceof ServiceType);
  }

  addService(ServiceType, name) {
    const service = new ServiceType(name);
    this.services.push(service);
    return service;
  }
}

function createApi() {
  const api = new EventEmitter();
  api.hap = {
    Service,
    Characteristic,
    uuid: { generate: (value) => `uuid:${value}` },
  };
  api.platformAccessory = FakePlatformAccessory;
  api.registered = [];
  api.unregistered = [];
  api.updated = [];
  api.registerPlatform = (plugin, alias, Constructor) => {
    api.PlatformConstructor = Constructor;
    api.platformRegistration = { plugin, alias };
  };
  api.registerAccessory = (plugin, alias, Constructor) => {
    api.LegacyConstructor = Constructor;
    api.accessoryRegistration = { plugin, alias };
  };
  api.registerPlatformAccessories = (plugin, alias, accessories) => {
    api.registered.push(...accessories);
  };
  api.unregisterPlatformAccessories = (plugin, alias, accessories) => {
    api.unregistered.push(...accessories);
  };
  api.updatePlatformAccessories = (accessories) => {
    api.updated.push(...accessories);
  };
  return api;
}

function createLog() {
  const messages = [];
  const log = (message) => messages.push(["log", message]);
  log.info = (message) => messages.push(["info", message]);
  log.warn = (message) => messages.push(["warn", message]);
  log.error = (message) => messages.push(["error", message]);
  log.messages = messages;
  return log;
}

const validConfig = {
  platform: "ElectromagneticLock",
  name: "Front Door",
  lockPin: 18,
  gpioChip: 0,
  activeLow: true,
  unlockingDuration: 2,
};

test.beforeEach(() => {
  gpioOperations.length = 0;
});

test("registers a dynamic platform and the backward-compatible accessory", () => {
  const api = createApi();
  initialisePlugin(api);

  assert.deepEqual(api.platformRegistration, {
    plugin: "homebridge-electromagnetic-lock",
    alias: "ElectromagneticLock",
  });
  assert.deepEqual(api.accessoryRegistration, {
    plugin: "homebridge-electromagnetic-lock",
    alias: "ElectromagneticLock",
  });
});

test("requests an active-low GPIO line directly in the secure state", () => {
  const api = createApi();
  initialisePlugin(api);
  new api.PlatformConstructor(createLog(), validConfig, api);

  api.emit("didFinishLaunching");

  assert.equal(api.registered.length, 1);
  assert.deepEqual(gpioOperations.slice(0, 3), [
    ["chip", 0],
    ["line", 0, 18],
    ["requestOutputMode", "homebridge-electromagnetic-lock", 1],
  ]);
  assert.equal(gpioOperations.some(([operation]) => operation === "setValue"), false);
});

test("keeps current and target states synchronized while unlocking and securing", async () => {
  const api = createApi();
  initialisePlugin(api);
  new api.PlatformConstructor(createLog(), validConfig, api);
  api.emit("didFinishLaunching");

  const lockService = api.registered[0].getService(LockMechanism);
  const current = lockService.getCharacteristic(Characteristic.LockCurrentState);
  const target = lockService.getCharacteristic(Characteristic.LockTargetState);

  await target.setter(0);
  assert.equal(current.value, 0);
  assert.equal(target.value, 0);
  assert.equal(current.getter(), 0);
  assert.equal(target.getter(), 0);
  assert.deepEqual(gpioOperations.at(-1), ["setValue", 0]);

  await target.setter(1);
  assert.equal(current.value, 1);
  assert.equal(target.value, 1);
  assert.equal(current.getter(), 1);
  assert.equal(target.getter(), 1);
  assert.deepEqual(gpioOperations.at(-1), ["setValue", 1]);
});

test("writes the secure value and releases GPIO during shutdown", async () => {
  const api = createApi();
  initialisePlugin(api);
  new api.PlatformConstructor(createLog(), validConfig, api);
  api.emit("didFinishLaunching");

  const lockService = api.registered[0].getService(LockMechanism);
  await lockService.getCharacteristic(Characteristic.LockTargetState).setter(0);
  api.emit("shutdown");

  assert.deepEqual(gpioOperations.slice(-2), [["setValue", 1], ["release"]]);
});

test("restores a matching cached accessory and unregisters stale cache entries", () => {
  const api = createApi();
  initialisePlugin(api);
  const platform = new api.PlatformConstructor(createLog(), validConfig, api);
  const matching = new FakePlatformAccessory(
    "Front Door",
    "uuid:homebridge-electromagnetic-lock:Front Door",
  );
  const stale = new FakePlatformAccessory("Old Door", "uuid:old-door");
  platform.configureAccessory(matching);
  platform.configureAccessory(stale);

  api.emit("didFinishLaunching");

  assert.equal(api.registered.length, 0);
  assert.deepEqual(api.unregistered, [stale]);
  assert.deepEqual(api.updated, [matching]);
});

test("invalid configuration does not reserve GPIO or register an accessory", () => {
  const api = createApi();
  initialisePlugin(api);
  const log = createLog();
  new api.PlatformConstructor(log, { name: "", lockPin: -1 }, api);

  api.emit("didFinishLaunching");

  assert.equal(api.registered.length, 0);
  assert.equal(gpioOperations.length, 0);
  assert.equal(log.messages.some(([level]) => level === "error"), true);
});

test("legacy accessory configuration remains operational", async () => {
  const api = createApi();
  initialisePlugin(api);
  const accessory = new api.LegacyConstructor(createLog(), {
    accessory: "ElectromagneticLock",
    name: "Legacy Door",
    lockPin: 18,
  });
  const services = accessory.getServices();
  const lockService = services.find((service) => service instanceof LockMechanism);

  await lockService.getCharacteristic(Characteristic.LockTargetState).setter(0);

  assert.equal(lockService.getCharacteristic(Characteristic.LockCurrentState).value, 0);
  assert.deepEqual(gpioOperations.at(-1), ["setValue", 0]);
});
