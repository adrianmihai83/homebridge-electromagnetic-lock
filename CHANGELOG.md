# Changelog

## 2.0.2

- Add a Homebridge dynamic platform while preserving the legacy accessory configuration.
- Declare support for Homebridge 2 and Node.js 22.12 and 24.
- Keep HomeKit current and target lock states synchronized.
- Always restore the physical and reported lock state to secured on startup.
- Prevent an active-low relay unlock pulse while requesting the GPIO output line.
- Automatically re-secure the lock after the configured duration.
- Report GPIO failures as a jammed lock instead of crashing Homebridge.
- Re-secure and release the GPIO line during Homebridge shutdown.
- Remove `underscore` and `node-persist` runtime dependencies.
- Update the native GPIO build toolchain for Node.js 22 and 24.
- Add configuration validation and automated tests.

## 2.0.1

- Publish the libgpiod-based Homebridge 2 release under the original npm package name.

## 2.0.0

- Replace the deprecated sysfs/rpi-gpio backend with `node-libgpiod`.
- Change `lockPin` from a physical Raspberry Pi header pin to a BCM/libgpiod line number.
- Add Homebridge 2 and modern Node.js engine declarations.
