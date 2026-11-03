# Homebridge Electromagnetic Lock

Control an electromagnetic lock through a Raspberry Pi GPIO line and expose it
to Apple Home as a lock mechanism.

Version 2.0.2 uses a Homebridge dynamic platform and is designed for
Homebridge 2 with Node.js 22.12 or 24.

## Safety behaviour

- The GPIO line is requested directly in the secured state, including for an
  active-low relay.
- The lock automatically returns to the secured state after the configured
  unlock duration.
- Homebridge and HomeKit states are updated together.
- GPIO failures are shown as a jammed lock instead of crashing Homebridge.
- During shutdown, the plugin writes the secured value before releasing the
  GPIO line.

Test the relay logic without connecting the lock power supply. Hardware design
must provide a safe state when the Raspberry Pi is powered off or the GPIO line
is released.

## Requirements

- Homebridge 2.x
- Node.js 22.12.x or 24.x
- Raspberry Pi OS / Debian with a libgpiod 1.x development package
- A relay interface suitable for the Raspberry Pi's 3.3 V GPIO

On Debian 12 / Raspberry Pi OS Bookworm:

```sh
sudo apt update
sudo apt install -y build-essential gpiod libgpiod-dev
```

The Homebridge service user must have permission to access `/dev/gpiochip*`.
On standard Raspberry Pi OS installations this normally means membership in
the `gpio` group:

```sh
sudo usermod -aG gpio homebridge
sudo hb-service restart
```

## Installation

```sh
sudo npm install -g homebridge-electromagnetic-lock
```

Homebridge UI can also install the package by searching for
`homebridge-electromagnetic-lock`.

## Configuration

New installations should use the dynamic platform:

```json
{
  "platform": "ElectromagneticLock",
  "name": "Lock",
  "lockPin": 18,
  "gpioChip": 0,
  "activeLow": true,
  "unlockingDuration": 2
}
```

- `name`: accessory name shown in Apple Home.
- `lockPin`: BCM GPIO / libgpiod line number, not the physical header pin.
- `gpioChip`: libgpiod chip number; normally `0`.
- `activeLow`: `true` when GPIO value 0 activates the relay.
- `unlockingDuration`: seconds before automatic re-lock, from 1 to 3600.

For example, Raspberry Pi physical header pin 12 is BCM GPIO 18, so configure
`"lockPin": 18`.

## Upgrading

### From 2.0.1

The old accessory configuration remains supported in 2.0.2, so existing
installations continue to start:

```json
{
  "accessory": "ElectromagneticLock",
  "name": "Lock",
  "lockPin": 18,
  "gpioChip": 0,
  "activeLow": true,
  "unlockingDuration": 2
}
```

To use the dynamic platform, remove that block from `accessories` and add the
new block to `platforms`. Do not keep both configurations active because both
would attempt to reserve the same GPIO line.

### From 1.x

Version 2 changed the backend from `rpi-gpio`/sysfs to libgpiod. The
`lockPin` option is now a BCM GPIO line number rather than a physical header
pin. For example, replace physical pin 12 with `"lockPin": 18`.

## Troubleshooting

- Confirm the chip and line with `gpioinfo`.
- Confirm the Homebridge service user can access `/dev/gpiochip*`.
- Install `libgpiod-dev` before installing the npm package because the native
  GPIO binding is compiled locally.
- Run Homebridge in debug mode and look for the plugin's GPIO initialization
  message.
