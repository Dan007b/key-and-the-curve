# Hardware

The controller is an ESP32 dev board with a BNO055 orientation sensor. The board's own BOOT button is the only button. It streams orientation to the laptop over USB at 100 Hz; the game reads it with Web Serial.

The game is fully playable on keyboard, so none of this is required to try it.

## Parts

| Part | Notes |
|---|---|
| ESP32-DevKitC V4 (ESP32-WROOM-32D) | Classic ESP32. No native USB; it talks through an onboard USB-to-UART chip (CP2102 or CH340). |
| Adafruit BNO055 breakout | 9-axis IMU with on-chip sensor fusion. Has its own I2C pull-ups and a 32.768 kHz crystal. |
| Micro-USB data cable | Some cables are charge-only and will not show a COM port. |

## Wiring

Everything connects to **one header**: the side with the 5V (or VIN) and GND pins.

| BNO055 pin | ESP32 pin |
|---|---|
| VIN | 3V3 if that header has it, otherwise 5V/VIN (see below) |
| GND | GND |
| SDA | GPIO25 |
| SCL | GPIO26 |
| ADR | leave unconnected (address 0x28) |

### The button

There is no extra button to wire: the DevKitC's **BOOT** button (GPIO0) is the trigger. **Press once to enter 4D twist mode, press again to leave it.** The firmware only reports whether BOOT is held (debounced, 20 ms); the game turns presses into the on/off toggle, so it can also switch twist mode off itself (for example on levels where twisting is disabled).

Don't hold BOOT while plugging the board in or pressing EN: GPIO0 is sampled at reset, and holding it low starts the bootloader instead of the firmware. Pressing it at any other time is safe.

Resetting the key is done from the keyboard (R) or the on-screen button.

### Powering the BNO055 from 5V/VIN

The official DevKitC V4 has 3V3, GND and 5V all on this header, so use 3V3. Some clone boards (for example the 30-pin "DevKit V1" layout) put 3V3 on the other header, leaving only VIN and GND on this side.

The Adafruit BNO055 accepts 3.3–5 V on its VIN pin and has its own 3.3 V regulator, so powering it from VIN is fine. The only thing to protect is the ESP32, whose pins are not 5 V tolerant. Before connecting SDA/SCL to the ESP32 the first time, power the breakout from VIN and measure SDA and SCL to GND with a multimeter: they should read about 3.3 V (pulled up to the breakout's regulator). If either reads about 5 V, do not connect it; power the breakout from 3V3 instead.

### Why these pins

- **GPIO25/26** carry I2C. The ESP32 can route I2C to any GPIO, and these two are on the same header as power and GND. The usual defaults, GPIO21/22, are on the other header.
- **GPIO0** is the BOOT button, already on the board. It is a strapping pin, which is fine for a button as long as it isn't held during reset (see above).
- **Avoid** GPIO6–11 (wired to the module's flash; using them crashes the board), GPIO2, 5, 12 and 15 (strapping pins that affect boot), and GPIO34–39 (input-only, with no internal pull-up, so `INPUT_PULLUP` silently does nothing).

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
#cal loaded from NVS
#bno055 ok at 0x28, NDOF, ext crystal on, i2c 100000 Hz
#bno055 after init: mode 12, status 5, error 0
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
| `btn` | 1 while BOOT is held, else 0 (bit1 is reserved and always 0). The game toggles twist mode on each press. |

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
| `#bno055 ... restarting sensor` | Fusion produced no orientation for 2 s (the chip did not enter NDOF mode), so the firmware restarted it. Once at boot is harmless; repeatedly points to a loose I2C wire. In the state line, mode 12 = NDOF, status 5 = fusion running. |
| `cal` stays at `0` for `mag` | Magnetic interference nearby; move away from metal and electronics and redo the figure-8. |
