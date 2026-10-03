# Hardware

The controller is an ESP32 dev board with a BNO055 orientation sensor and two buttons. It streams orientation to the laptop over USB at 100 Hz; the game reads it with Web Serial.

The game is fully playable on keyboard, so none of this is required to try it.

## Parts

| Part | Notes |
|---|---|
| ESP32-DevKitC V4 (ESP32-WROOM-32D) | Classic ESP32. No native USB; it talks through an onboard USB-to-UART chip (CP2102 or CH340). |
| Adafruit BNO055 breakout | 9-axis IMU with on-chip sensor fusion. Has its own I2C pull-ups and a 32.768 kHz crystal. |
| 2 momentary push buttons | Trigger and reset-key. |
| Micro-USB data cable | Some cables are charge-only and will not show a COM port. |

## Wiring

| BNO055 pin | ESP32 pin |
|---|---|
| VIN | 3V3 |
| GND | GND |
| SDA | GPIO21 |
| SCL | GPIO22 |
| ADR | leave unconnected (address 0x28) |

| Button | ESP32 pin | Other leg |
|---|---|---|
| Trigger | GPIO32 | GND |
| Reset-key | GPIO33 | GND |

The buttons need no resistors: the firmware enables the ESP32's internal pull-ups, so a pressed button reads LOW. The firmware also debounces them (20 ms).

### Why these pins

- **GPIO21/22** are the ESP32's default I2C pins.
- **GPIO32/33** are plain I/O pins with internal pull-ups and no boot-time role.
- **Avoid** GPIO6–11 (wired to the module's flash; using them crashes the board), GPIO0, 2, 5, 12 and 15 (strapping pins that affect boot), and GPIO34–39 (input-only, with no internal pull-up, so `INPUT_PULLUP` silently does nothing).

## Flashing (PowerShell)

```powershell
cd firmware
pio run -t upload
pio device monitor
```

If `pio` is not on your PATH, use `& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe"` instead.

The serial link runs at **921600 baud** (set in `platformio.ini`). At 115200 the 100 Hz stream would use about 75% of the link; 921600 leaves plenty of headroom. If you see garbage, drop both `monitor_speed` and `kBaud` in `src/main.cpp` to 460800.

If no COM port appears when the board is plugged in, check the USB chip printed next to the micro-USB connector. The CP2102 driver usually installs automatically on Windows; the CH340 may need its driver installed from the chip vendor (WCH).

## What you should see

```
#key-and-the-curve controller fw (esp32dev)
#i2c device at 0x28
#cal none stored (calibrate, then send S)
#bno055 ok at 0x28, NDOF, ext crystal on, i2c 100000 Hz
$,0.99994,-0.00412,0.00897,0.00015,0.07,-0.17,9.80,0.0011,-0.0022,0.0000,300,0
$,0.99994,-0.00412,0.00897,0.00015,0.07,-0.17,9.80,0.0000,-0.0011,0.0011,300,0
...
#hz 100.0 overruns 0
```

Lines starting with `#` are status messages, and the game ignores them. A `#hz` line appears every 5 seconds. For the first fraction of a second after the sensor starts, the fusion engine has no orientation yet, so the firmware holds back samples until it does.

To check the stream automatically (close the monitor first, then use your board's COM port):

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\python.exe" tools\check_stream.py COM3
```

It validates every line for 5 seconds and prints `PASS` if the rate is 90–110 Hz with no malformed lines.

## Serial protocol

One line per sample, 100 Hz:

```
$,qw,qx,qy,qz,gx,gy,gz,wx,wy,wz,cal,btn
```

| Fields | Meaning |
|---|---|
| `qw..qz` | Fused orientation quaternion (unit length, 5 decimals). |
| `gx..gz` | Gravity vector in the sensor frame, m/s² (0.01 resolution). |
| `wx..wz` | Gyro angular velocity, **rad/s**. |
| `cal` | Calibration status `sys*1000 + gyr*100 + acc*10 + mag`, each 0–3. It is a plain integer, so leading zeros are dropped: `300` means sys 0, gyr 3, acc 0, mag 0. `3333` is fully calibrated. |
| `btn` | Bitmask: 1 = trigger held, 2 = reset-key held, 3 = both. |

**Gyro units.** The BNO055 powers up reporting deg/s, and the Adafruit library never changes that register; its `getVector(VECTOR_GYROSCOPE)` divides the raw value by 16 LSB per deg/s. The firmware multiplies by π/180, so the stream is in rad/s.

**Commands from the laptop** (each ends with a newline; you can type them into `pio device monitor` and press Enter):

| Command | Effect |
|---|---|
| `P` | Replies `#pong`. |
| `S` | Saves calibration to flash, only if `cal` is `3333`. Replies `#cal saved to NVS` or explains why not. |
| `V,<0-255>` | Vibration strength. Accepted and ignored, because no motor is fitted. |

## Calibration

The BNO055 calibrates itself continuously, but it needs to see certain motions first. Watch the `cal` field (digits `sys gyr acc mag`; leading zeros are dropped, so `30` means only acc is 3) and do the following, roughly in this order:

1. **Gyroscope** (`gyr`, second digit). Put the controller down and leave it completely still for 2–3 seconds.
2. **Magnetometer** (`mag`, fourth digit). Move it through the air in a slow figure-8 a few times. Stay away from magnets, laptop speakers, and steel desks.
3. **Accelerometer** (`acc`, third digit). This is the slowest one. Hold it still in about six different orientations for 2–3 seconds each: flat, upside down, on each of its four edges. Include a few in-between angles if it is stubborn.
4. **System** (`sys`, first digit) reaches 3 once the others are good.

When `cal` reads `3333`, type `S` and press Enter. The offsets are stored in the ESP32's flash (NVS) and restored on every boot.

After a reboot with stored offsets, the digits still start low. That is normal: the chip reports 0 until it has seen a little motion, but it converges within a few seconds instead of needing the full routine. If you move the sensor to a different magnetic environment, redo the figure-8.

## Build options

Set these in `platformio.ini` under `build_flags` if needed:

| Flag | Default | Use |
|---|---|---|
| `-DI2C_CLOCK_HZ=50000` | 100000 | If readings freeze or glitch. The BNO055 stretches the I2C clock, and some setups are happier at 50 kHz. |
| `-DBNO055_EXT_CRYSTAL=0` | 1 | For BNO055 boards without the 32.768 kHz crystal. |

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `#i2c no devices found` | SDA/SCL swapped, VIN not connected, or a loose jumper. |
| `#bno055 not found at 0x28 or 0x29` | Something else is on the bus but not the BNO055; check the scan output. |
| Garbled text in the monitor | Baud mismatch; the monitor must be at 921600. |
| `Access is denied` when uploading | Another program (a monitor, the game, Arduino IDE) has the COM port open. |
| Board resets when a program opens the port | The DevKitC's auto-reset circuit reacts to DTR/RTS. The game and `check_stream.py` keep both low to avoid this. |
| `cal` stays at `0` for `mag` | Magnetic interference nearby; move away from metal and electronics and redo the figure-8. |
