# Homebridge2 Electromagnetic Lock

Homebridge2 Electromagnetic Lock plugin to control electromagnetic lock via Raspberry Pi GPIO lines.

## Objective

Electromagnetic lock controlled through libgpiod.

## Installation

1. install homebridge
   `npm install -g homebridge`
2. install libgpiod
   `sudo apt install -y gpiod libgpiod-dev`
3. install this plugin
   `npm install -g homebridge-electromagnetic-lock-v2`
4. update your `~/.homebridge/config.json` file (use `sample-config.json` as a reference)

## Configuration

Sample accessory:

```
"accessories": [
  {
    "accessory": "ElectromagneticLock2",
    "name": "Lock",
    "lockPin": 18,
    "gpioChip": 0,
    "activeLow": true,
    "unlockingDuration": 2
  }
]
```

Fields:

- `accessory` must always be _ElectromagneticLock2_
- `name` accessory name, e.g. _Lock_
- `lockPin` BCM GPIO / libgpiod line number for unlocking lock, not physical board pin
- `gpioChip` [optional, default: *0*] GPIO chip number used by libgpiod, usually *0* on Raspberry Pi
- `activeLow` [optional, default: *true*] true: relay activated by low state (0), false: relay activated by high state (1), affects _lockPin_
- `unlockingDuration` [optional, default: *2*] how long _lockPin_ should be active (seconds)

For example, Raspberry Pi physical pin 12 is BCM GPIO 18, so use `"lockPin": 18`.

## Troubleshooting

- check platform: [Homebridge](https://github.com/nfarina/homebridge)
- check plugin dependency: [underscore](Install: npm install underscore -> https://www.npmjs.com/package/underscore)
- check plugin dependency: [node-libgpiod](https://www.npmjs.com/package/node-libgpiod)

## Attribution

This project is based on Homebridge GPIO Electromagnetic Lock by Panda Unit sp. z o.o. (github.com/pandaunit/homebridge-gpio-electromagnetic-lock).
