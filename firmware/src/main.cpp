// The Key and the Curve: controller firmware (ESP32-DevKitC V4 + Adafruit BNO055).
//
// Streams fused orientation, gravity, gyro rate, calibration status and button
// state at 100 Hz over the board's USB-UART bridge, one line per sample:
//
//   $,qw,qx,qy,qz,gx,gy,gz,wx,wy,wz,cal,btn\n
//
//   qw..qz  fused unit quaternion (5 decimals)
//   gx..gz  gravity vector in the sensor frame, m/s^2
//   wx..wz  gyro angular velocity, rad/s (the BNO055 reports deg/s; converted here)
//   cal     sys*1000 + gyr*100 + acc*10 + mag, each 0..3, printed as a plain
//           integer (so "300" means sys 0, gyr 3, acc 0, mag 0)
//   btn     bit0 = trigger, bit1 = reset-key (1 = pressed)
//
// Lines starting with '#' are debug/status output; the game ignores them.
//
// Host -> device commands, newline-terminated:
//   V,<0-255>  vibration strength (accepted and ignored: no motor fitted)
//   S          save calibration offsets to NVS, only if fully calibrated (3/3/3/3)
//   P          ping, answers "#pong"
//
// See docs/HARDWARE.md for wiring and the calibration procedure.

#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>

// ---- Hardware configuration (confirmed by Danny, 2026-10-03) ----------------

static constexpr int kPinSda = 21;
static constexpr int kPinScl = 22;
static constexpr int kPinTrigger = 32;
static constexpr int kPinResetKey = 33;

// The Adafruit breakout has a 32.768 kHz crystal, which improves fusion
// accuracy. Build with -DBNO055_EXT_CRYSTAL=0 for boards without one.
#ifndef BNO055_EXT_CRYSTAL
#define BNO055_EXT_CRYSTAL 1
#endif

// The BNO055 stretches the I2C clock. 100 kHz works on most setups; if reads
// are flaky (frozen values, garbage quaternions), build with -DI2C_CLOCK_HZ=50000.
#ifndef I2C_CLOCK_HZ
#define I2C_CLOCK_HZ 100000
#endif

// ---- Timing and protocol -----------------------------------------------------

// Must match monitor_speed in platformio.ini and the game's Web Serial baud.
static constexpr uint32_t kBaud = 921600;
// 100 Hz, which is also the BNO055's NDOF fusion output rate.
static constexpr uint32_t kSamplePeriodUs = 10000;
static constexpr uint32_t kDebounceMs = 20;
static constexpr uint32_t kStatsPeriodMs = 5000;
static constexpr uint32_t kSensorRetryMs = 2000;
// The BNO055 needs ~650 ms after power-up before it answers on I2C.
static constexpr uint32_t kBnoBootMs = 700;

static const char* const kPrefsNamespace = "bno055";
static const char* const kPrefsKeyOffsets = "offsets";

// ---- Buttons -----------------------------------------------------------------

// A button wired from a GPIO to GND with the internal pull-up, so LOW = pressed.
// The debounced state changes only after the raw input has been stable for
// kDebounceMs. update() must be called often (every loop iteration).
struct DebouncedButton {
    const int pin;
    bool pressed = false;  // debounced state
    bool lastRaw = false;
    uint32_t lastChangeMs = 0;

    explicit DebouncedButton(int p) : pin(p) {}

    void begin() {
        pinMode(pin, INPUT_PULLUP);
        lastRaw = pressed = (digitalRead(pin) == LOW);
    }

    void update(uint32_t nowMs) {
        const bool raw = (digitalRead(pin) == LOW);
        if (raw != lastRaw) {
            lastRaw = raw;
            lastChangeMs = nowMs;
        } else if (raw != pressed && nowMs - lastChangeMs >= kDebounceMs) {
            pressed = raw;
        }
    }
};

static DebouncedButton trigger(kPinTrigger);
static DebouncedButton resetKey(kPinResetKey);

// ---- Sensor ------------------------------------------------------------------

// Created after the I2C scan, once we know which address the sensor is on.
static Adafruit_BNO055* bno = nullptr;
static Preferences prefs;

// Scans the whole I2C bus, prints every device found, and returns the BNO055
// address (0x28 or 0x29), or 0 if neither responded.
static uint8_t scanI2c() {
    uint8_t bnoAddr = 0;
    int found = 0;
    for (uint8_t addr = 1; addr < 127; ++addr) {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
            Serial.printf("#i2c device at 0x%02X\n", addr);
            ++found;
            if (bnoAddr == 0 && (addr == BNO055_ADDRESS_A || addr == BNO055_ADDRESS_B)) {
                bnoAddr = addr;
            }
        }
    }
    if (found == 0) {
        Serial.println("#i2c no devices found (check wiring and power)");
    }
    return bnoAddr;
}

// Restores calibration offsets saved by a previous "S" command, if any.
// The BNO055 still reports low calibration digits until it has seen a little
// motion, but the restored offsets make it converge within seconds.
static void loadCalibration() {
    adafruit_bno055_offsets_t offsets;
    size_t n = 0;
    prefs.begin(kPrefsNamespace, /*readOnly=*/true);
    if (prefs.getBytesLength(kPrefsKeyOffsets) == sizeof(offsets)) {
        n = prefs.getBytes(kPrefsKeyOffsets, &offsets, sizeof(offsets));
    }
    prefs.end();

    if (n == sizeof(offsets)) {
        bno->setSensorOffsets(offsets);
        Serial.println("#cal loaded from NVS");
    } else {
        Serial.println("#cal none stored (calibrate, then send S)");
    }
}

// Saves the current offsets to NVS, but only when every subsystem reports 3/3.
// Reading offsets briefly switches the chip to CONFIG mode, so the stream
// pauses for ~50 ms and fusion restarts; that is fine for a one-off command.
static void saveCalibration() {
    if (bno == nullptr) {
        Serial.println("#cal not saved: no sensor");
        return;
    }
    uint8_t sys, gyr, acc, mag;
    bno->getCalibration(&sys, &gyr, &acc, &mag);
    if (sys < 3 || gyr < 3 || acc < 3 || mag < 3) {
        Serial.printf("#cal not saved: not fully calibrated (sys=%u gyr=%u acc=%u mag=%u)\n",
                      sys, gyr, acc, mag);
        return;
    }
    adafruit_bno055_offsets_t offsets;
    if (!bno->getSensorOffsets(offsets)) {
        Serial.println("#cal not saved: calibration dropped while reading offsets");
        return;
    }
    prefs.begin(kPrefsNamespace, /*readOnly=*/false);
    const size_t written = prefs.putBytes(kPrefsKeyOffsets, &offsets, sizeof(offsets));
    prefs.end();
    Serial.println(written == sizeof(offsets) ? "#cal saved to NVS" : "#cal not saved: NVS write failed");
}

// Finds and initializes the BNO055 in NDOF (9-axis fusion) mode.
static bool initSensor() {
    const uint8_t addr = scanI2c();
    if (addr == 0) {
        Serial.println("#bno055 not found at 0x28 or 0x29");
        return false;
    }
    bno = new Adafruit_BNO055(55, addr, &Wire);
    if (!bno->begin(OPERATION_MODE_NDOF)) {
        Serial.printf("#bno055 at 0x%02X did not initialize\n", addr);
        delete bno;
        bno = nullptr;
        return false;
    }
    // begin() goes through Adafruit BusIO, which may touch the bus setup; make
    // sure the clock is still what we asked for.
    Wire.setClock(I2C_CLOCK_HZ);
    loadCalibration();
    bno->setExtCrystalUse(BNO055_EXT_CRYSTAL);
    Serial.printf("#bno055 ok at 0x%02X, NDOF, ext crystal %s, i2c %u Hz\n",
                  addr, BNO055_EXT_CRYSTAL ? "on" : "off", (unsigned)I2C_CLOCK_HZ);
    return true;
}

// Reads one sample and writes it as a single protocol line. Returns false if
// the sample was skipped because fusion has not produced an orientation yet.
// I2C cost at 100 kHz: ~40 bytes in 4 transactions, about 4 ms of the 10 ms budget.
static bool streamSample() {
    const imu::Quaternion q = bno->getQuat();
    // Right after init (and after a CONFIG-mode round trip) the fusion engine
    // reports an all-zero quaternion for a few samples. The protocol promises a
    // unit quaternion, so skip those rather than send them.
    const double qNorm2 = q.w() * q.w() + q.x() * q.x() + q.y() * q.y() + q.z() * q.z();
    if (qNorm2 < 0.25) {
        return false;
    }
    const imu::Vector<3> g = bno->getVector(Adafruit_BNO055::VECTOR_GRAVITY);
    // The library leaves UNIT_SEL at its reset default (deg/s) and divides the
    // raw value by 16 LSB/dps, so this is deg/s. Convert to rad/s below.
    const imu::Vector<3> w = bno->getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);

    uint8_t sys, gyr, acc, mag;
    bno->getCalibration(&sys, &gyr, &acc, &mag);
    const int cal = sys * 1000 + gyr * 100 + acc * 10 + mag;
    const int btn = (trigger.pressed ? 1 : 0) | (resetKey.pressed ? 2 : 0);

    // Gravity has 0.01 m/s^2 resolution; gyro has 1/16 dps = 0.0011 rad/s.
    char line[160];
    const int n = snprintf(line, sizeof(line),
                           "$,%.5f,%.5f,%.5f,%.5f,%.2f,%.2f,%.2f,%.4f,%.4f,%.4f,%d,%d\n",
                           q.w(), q.x(), q.y(), q.z(),
                           g.x(), g.y(), g.z(),
                           w.x() * DEG_TO_RAD, w.y() * DEG_TO_RAD, w.z() * DEG_TO_RAD,
                           cal, btn);
    if (n > 0 && n < (int)sizeof(line)) {
        Serial.write(reinterpret_cast<const uint8_t*>(line), n);
    }
    return true;
}

// ---- Host commands -----------------------------------------------------------

static void handleCommand(const char* cmd) {
    if (cmd[0] == '\0') {
        return;
    }
    if (strcmp(cmd, "P") == 0) {
        Serial.println("#pong");
    } else if (strcmp(cmd, "S") == 0) {
        saveCalibration();
    } else if (strncmp(cmd, "V,", 2) == 0) {
        char* end = nullptr;
        const long v = strtol(cmd + 2, &end, 10);
        if (end == cmd + 2 || *end != '\0' || v < 0 || v > 255) {
            Serial.printf("#err bad vibration value: %s\n", cmd);
        }
        // Valid values are accepted silently: no vibration motor is fitted.
    } else {
        Serial.printf("#err unknown command: %s\n", cmd);
    }
}

// Reads whatever bytes are waiting and dispatches complete lines.
// Over-long lines are discarded up to the next newline.
static void pollCommands() {
    static char buf[32];
    static size_t len = 0;
    static bool overflowed = false;

    while (Serial.available() > 0) {
        const char c = static_cast<char>(Serial.read());
        if (c == '\r') {
            continue;
        }
        if (c == '\n') {
            if (!overflowed) {
                buf[len] = '\0';
                handleCommand(buf);
            }
            len = 0;
            overflowed = false;
        } else if (len < sizeof(buf) - 1) {
            buf[len++] = c;
        } else {
            overflowed = true;
        }
    }
}

// ---- Main loop ---------------------------------------------------------------

static uint32_t nextSampleUs = 0;
static uint32_t lastRetryMs = 0;
static uint32_t statsStartMs = 0;
static uint32_t statsSamples = 0;
static uint32_t statsOverruns = 0;

void setup() {
    Serial.begin(kBaud);
    Serial.println();
    Serial.println("#key-and-the-curve controller fw (esp32dev)");

    trigger.begin();
    resetKey.begin();

    Wire.begin(kPinSda, kPinScl, I2C_CLOCK_HZ);
    while (millis() < kBnoBootMs) {
        delay(10);
    }
    initSensor();

    lastRetryMs = statsStartMs = millis();
    nextSampleUs = micros();
}

void loop() {
    const uint32_t nowMs = millis();
    trigger.update(nowMs);
    resetKey.update(nowMs);
    pollCommands();

    if (bno == nullptr) {
        if (nowMs - lastRetryMs >= kSensorRetryMs) {
            lastRetryMs = nowMs;
            if (initSensor()) {
                nextSampleUs = micros();
                statsStartMs = nowMs;
                statsSamples = statsOverruns = 0;
            }
        }
        return;
    }

    const uint32_t nowUs = micros();
    if (static_cast<int32_t>(nowUs - nextSampleUs) >= 0) {
        nextSampleUs += kSamplePeriodUs;
        // If we fell more than a whole period behind (e.g. during "S"), resync
        // instead of bursting catch-up samples.
        if (static_cast<int32_t>(nowUs - nextSampleUs) >= static_cast<int32_t>(kSamplePeriodUs)) {
            nextSampleUs = nowUs + kSamplePeriodUs;
            ++statsOverruns;
        }
        if (streamSample()) {
            ++statsSamples;
        }
    }

    // Periodic rate report, handy for checking the ~100 Hz target in a monitor.
    if (nowMs - statsStartMs >= kStatsPeriodMs) {
        const float hz = statsSamples * 1000.0f / (nowMs - statsStartMs);
        Serial.printf("#hz %.1f overruns %u\n", hz, (unsigned)statsOverruns);
        statsStartMs = nowMs;
        statsSamples = statsOverruns = 0;
    }
}
