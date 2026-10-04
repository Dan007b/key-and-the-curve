// Phase Escape: controller firmware (ESP32-DevKitC V4 + Adafruit BNO055).
//
// Streams gravity, gyro rate, calibration status and button state at 100 Hz,
// both wirelessly over Bluetooth Low Energy (see "Bluetooth" below) and over
// the board's USB-UART bridge. Over USB it sends one line per sample:
//
//   $,qw,qx,qy,qz,gx,gy,gz,wx,wy,wz,cal,btn\n
//
//   qw..qz  fused unit quaternion (5 decimals)
//   gx..gz  gravity vector in the sensor frame, m/s^2
//   wx..wz  gyro angular velocity, rad/s (the BNO055 reports deg/s; converted here)
//   cal     sys*1000 + gyr*100 + acc*10 + mag, each 0..3, printed as a plain
//           integer (so "300" means sys 0, gyr 3, acc 0, mag 0)
//   btn     bit0 = BOOT button held (debounced), bit1 = reserved, always 0
//           (the game turns BOOT presses into the twist-mode toggle)
//
// Lines starting with '#' are debug/status output; the game ignores them.
//
// Host -> device commands, newline-terminated:
//   V,<0-255>  vibration strength (accepted and ignored: no motor fitted)
//   S          save calibration offsets to NVS, only if fully calibrated (3/3/3/3)
//   P          ping, answers "#pong"
//
// Bluetooth Low Energy: advertises as "PhaseEscape" with one GATT service
// (UUIDs below; the game has the same ones in serialProtocol.ts):
//   sample   notify, 16 bytes per sample, little-endian:
//              [0] format version (1)   [1] sequence number (wraps at 256)
//              [2] buttons (bit0 = BOOT) [3] calibration, 2 bits each:
//                                            sys<<6 | gyr<<4 | acc<<2 | mag
//              [4..9]   gravity x, y, z, int16, units of 0.01 m/s^2
//              [10..15] gyro x, y, z, int16, units of 1/16 deg/s
//            Both are the BNO055's own register units, so nothing is lost.
//            The quaternion is not sent: the game doesn't use it, and leaving
//            it out keeps a sample within one 20-byte notification.
//   command  write: the same commands as over USB ("P", "S", "V,n"), no newline
//   log      notify: the '#' lines, one per notification (cut to fit if long)
//
// See docs/HARDWARE.md for wiring, power and the calibration procedure.

#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <NimBLEDevice.h>
#include <stdarg.h>

// ---- Hardware configuration (confirmed by Danny, 2026-10-03) ----------------

// All four signals sit on the same header as 5V/VIN and GND, so the whole
// controller wires to one side of the board. The ESP32 can route I2C to any
// GPIO, so moving off the default 21/22 costs nothing.
static constexpr int kPinSda = 25;
static constexpr int kPinScl = 26;
// The controller has no separate buttons: the DevKitC's own BOOT button
// (GPIO0, external pull-up, pressed = LOW) is the trigger. GPIO0 is a strapping
// pin only at reset; holding BOOT while the board resets enters the bootloader,
// so don't hold it while plugging in.
static constexpr int kPinTrigger = 0;

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
// If fusion produces no orientation for this many sample periods (2 s), the
// sensor is restarted. This catches a lost mode-switch write during init: the
// Adafruit library ignores I2C write errors, and a BNO055 left in CONFIG mode
// reports an all-zero quaternion forever.
static constexpr uint32_t kFusionTimeoutSamples = 200;
// The BNO055 needs ~650 ms after power-up before it answers on I2C.
static constexpr uint32_t kBnoBootMs = 700;
// Settling time after selecting the external crystal. Adafruit's examples wait
// 1 s here; the chip's own power-on clock start-up is ~650 ms.
static constexpr uint32_t kClockSettleMs = 700;

static const char* const kPrefsNamespace = "bno055";
static const char* const kPrefsKeyOffsets = "offsets";

// ---- Bluetooth ---------------------------------------------------------------

static const char* const kBleName = "PhaseEscape";
static const char* const kServiceUuid = "6f1c0001-3b0e-4b7c-9f4a-2d8e5a7c1b90";
static const char* const kSampleUuid = "6f1c0002-3b0e-4b7c-9f4a-2d8e5a7c1b90";
static const char* const kCommandUuid = "6f1c0003-3b0e-4b7c-9f4a-2d8e5a7c1b90";
static const char* const kLogUuid = "6f1c0004-3b0e-4b7c-9f4a-2d8e5a7c1b90";
static constexpr uint8_t kSampleFormat = 1;

static NimBLEServer* bleServer = nullptr;
static NimBLECharacteristic* sampleChar = nullptr;
static NimBLECharacteristic* logChar = nullptr;

// A command written over BLE arrives on the Bluetooth task. It is copied here
// and run from loop(), so I2C and NVS are only ever touched by one task.
static portMUX_TYPE bleCmdLock = portMUX_INITIALIZER_UNLOCKED;
static char bleCmd[32];
static volatile bool bleCmdPending = false;

static bool bleConnected() {
    return bleServer != nullptr && bleServer->getConnectedCount() > 0;
}

// Writes a '#' status line to USB serial and, when a client is connected, to
// the BLE log characteristic. Call from loop()/setup() only.
static void hostLog(const char* fmt, ...) __attribute__((format(printf, 1, 2)));
static void hostLog(const char* fmt, ...) {
    char buf[128];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    Serial.println(buf);
    if (logChar != nullptr && bleConnected()) {
        logChar->setValue(reinterpret_cast<const uint8_t*>(buf), strlen(buf));
        logChar->notify();
    }
}

class ServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* server, ble_gap_conn_desc* desc) override {
        // Ask for a short connection interval (7.5-15 ms) so 100 Hz samples
        // arrive promptly; the host may choose something else.
        server->updateConnParams(desc->conn_handle, 6, 12, 0, 200);
    }
    // NimBLE restarts advertising on disconnect by default.
};

class CommandCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* c) override {
        const NimBLEAttValue v = c->getValue();
        portENTER_CRITICAL(&bleCmdLock);
        if (!bleCmdPending) {
            const size_t n = v.length() < sizeof(bleCmd) - 1 ? v.length() : sizeof(bleCmd) - 1;
            memcpy(bleCmd, v.data(), n);
            bleCmd[n] = '\0';
            bleCmdPending = true;
        }
        portEXIT_CRITICAL(&bleCmdLock);
    }
};

static void startBle() {
    NimBLEDevice::init(kBleName);
    bleServer = NimBLEDevice::createServer();
    bleServer->setCallbacks(new ServerCallbacks());
    NimBLEService* service = bleServer->createService(kServiceUuid);
    sampleChar = service->createCharacteristic(kSampleUuid, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
    NimBLECharacteristic* command =
        service->createCharacteristic(kCommandUuid, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
    command->setCallbacks(new CommandCallbacks());
    logChar = service->createCharacteristic(kLogUuid, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
    service->start();

    // Advertise the service (so the game can filter on it) and the name, in the
    // scan response (flags + 128-bit UUID already fill 21 of the 31 bytes).
    NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
    NimBLEAdvertisementData data;
    data.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
    data.setCompleteServices(NimBLEUUID(kServiceUuid));
    adv->setAdvertisementData(data);
    NimBLEAdvertisementData response;
    response.setName(kBleName);
    adv->setScanResponseData(response);
    adv->start();
    hostLog("#ble advertising as %s", kBleName);
}

// Encodes v as a little-endian int16 at p, rounded and clamped.
static void putInt16(uint8_t* p, double v) {
    long r = lround(v);
    if (r > 32767) r = 32767;
    if (r < -32768) r = -32768;
    const uint16_t u = static_cast<uint16_t>(static_cast<int16_t>(r));
    p[0] = u & 0xFF;
    p[1] = u >> 8;
}

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
            hostLog("#i2c device at 0x%02X", addr);
            ++found;
            if (bnoAddr == 0 && (addr == BNO055_ADDRESS_A || addr == BNO055_ADDRESS_B)) {
                bnoAddr = addr;
            }
        }
    }
    if (found == 0) {
        hostLog("#i2c no devices found (check wiring and power)");
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
        hostLog("#cal loaded from NVS");
    } else {
        hostLog("#cal none stored (calibrate, then send S)");
    }
}

// Saves the current offsets to NVS, but only when every subsystem reports 3/3.
// Reading offsets briefly switches the chip to CONFIG mode, so the stream
// pauses for ~50 ms and fusion restarts; that is fine for a one-off command.
static void saveCalibration() {
    if (bno == nullptr) {
        hostLog("#cal not saved: no sensor");
        return;
    }
    uint8_t sys, gyr, acc, mag;
    bno->getCalibration(&sys, &gyr, &acc, &mag);
    if (sys < 3 || gyr < 3 || acc < 3 || mag < 3) {
        hostLog("#cal not saved: not fully calibrated (sys=%u gyr=%u acc=%u mag=%u)",
                      sys, gyr, acc, mag);
        return;
    }
    adafruit_bno055_offsets_t offsets;
    if (!bno->getSensorOffsets(offsets)) {
        hostLog("#cal not saved: calibration dropped while reading offsets");
        return;
    }
    prefs.begin(kPrefsNamespace, /*readOnly=*/false);
    const size_t written = prefs.putBytes(kPrefsKeyOffsets, &offsets, sizeof(offsets));
    prefs.end();
    hostLog("%s", written == sizeof(offsets) ? "#cal saved to NVS" : "#cal not saved: NVS write failed");
}

// Prints the BNO055's operating mode and system status/error registers
// (datasheet §4.3.58–4.3.60). Mode 12 = NDOF, 0 = CONFIG; status 5 = fusion
// running; error 0 = none.
static void printSensorState(const char* when) {
    uint8_t status = 0, selfTest = 0, error = 0;
    bno->getSystemStatus(&status, &selfTest, &error);
    hostLog("#bno055 %s: mode %u, status %u, error %u",
                  when, (unsigned)bno->getMode(), status, error);
}

// Finds and initializes the BNO055 in NDOF (9-axis fusion) mode.
static bool initSensor() {
    const uint8_t addr = scanI2c();
    if (addr == 0) {
        hostLog("#bno055 not found at 0x28 or 0x29");
        return false;
    }
    bno = new Adafruit_BNO055(55, addr, &Wire);
    if (!bno->begin(OPERATION_MODE_NDOF)) {
        hostLog("#bno055 at 0x%02X did not initialize", addr);
        delete bno;
        bno = nullptr;
        return false;
    }
    // begin() goes through Adafruit BusIO, which may touch the bus setup; make
    // sure the clock is still what we asked for.
    Wire.setClock(I2C_CLOCK_HZ);
    // Switch the clock source first and let it settle before any other
    // configuration: writes made while the chip changes clocks can be lost.
    bno->setExtCrystalUse(BNO055_EXT_CRYSTAL);
    delay(kClockSettleMs);
    loadCalibration();
    hostLog("#bno055 ok at 0x%02X, NDOF, ext crystal %s, i2c %u Hz",
                  addr, BNO055_EXT_CRYSTAL ? "on" : "off", (unsigned)I2C_CLOCK_HZ);
    printSensorState("after init");
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
    const int btn = trigger.pressed ? 1 : 0;

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

    if (sampleChar != nullptr && bleConnected()) {
        static uint8_t seq = 0;
        uint8_t pkt[16];
        pkt[0] = kSampleFormat;
        pkt[1] = seq++;
        pkt[2] = static_cast<uint8_t>(btn);
        pkt[3] = static_cast<uint8_t>((sys << 6) | (gyr << 4) | (acc << 2) | mag);
        // Back to the BNO055's register units: 100 LSB per m/s^2, 16 LSB per deg/s.
        putInt16(pkt + 4, g.x() * 100);
        putInt16(pkt + 6, g.y() * 100);
        putInt16(pkt + 8, g.z() * 100);
        putInt16(pkt + 10, w.x() * 16);
        putInt16(pkt + 12, w.y() * 16);
        putInt16(pkt + 14, w.z() * 16);
        sampleChar->setValue(pkt, sizeof(pkt));
        sampleChar->notify();
    }
    return true;
}

// ---- Host commands -----------------------------------------------------------

static void handleCommand(const char* cmd) {
    if (cmd[0] == '\0') {
        return;
    }
    if (strcmp(cmd, "P") == 0) {
        hostLog("#pong");
    } else if (strcmp(cmd, "S") == 0) {
        saveCalibration();
    } else if (strncmp(cmd, "V,", 2) == 0) {
        char* end = nullptr;
        const long v = strtol(cmd + 2, &end, 10);
        if (end == cmd + 2 || *end != '\0' || v < 0 || v > 255) {
            hostLog("#err bad vibration value: %s", cmd);
        }
        // Valid values are accepted silently: no vibration motor is fitted.
    } else {
        hostLog("#err unknown command: %s", cmd);
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

// Runs a command that arrived over BLE, if one is waiting.
static void pollBleCommand() {
    if (!bleCmdPending) {
        return;
    }
    char cmd[sizeof(bleCmd)];
    portENTER_CRITICAL(&bleCmdLock);
    memcpy(cmd, bleCmd, sizeof(cmd));
    bleCmdPending = false;
    portEXIT_CRITICAL(&bleCmdLock);
    // Tolerate a trailing newline, as over USB.
    const size_t len = strlen(cmd);
    if (len > 0 && (cmd[len - 1] == '\n' || cmd[len - 1] == '\r')) {
        cmd[len - 1] = '\0';
    }
    handleCommand(cmd);
}

// ---- Main loop ---------------------------------------------------------------

static uint32_t nextSampleUs = 0;
static uint32_t lastRetryMs = 0;
static uint32_t statsStartMs = 0;
static uint32_t statsSamples = 0;
static uint32_t statsOverruns = 0;
static uint32_t samplesWithoutFusion = 0;

void setup() {
    Serial.begin(kBaud);
    Serial.println();
    hostLog("#phase-escape controller fw (esp32dev, usb + ble)");

    trigger.begin();
    startBle();

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
    pollCommands();
    pollBleCommand();

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
            samplesWithoutFusion = 0;
        } else if (++samplesWithoutFusion >= kFusionTimeoutSamples) {
            printSensorState("no fusion output for 2 s");
            hostLog("#bno055 restarting sensor");
            delete bno;
            bno = nullptr;
            samplesWithoutFusion = 0;
            lastRetryMs = nowMs - kSensorRetryMs;  // retry on the next loop
            return;
        }
    }

    // Periodic rate report, handy for checking the ~100 Hz target in a monitor.
    if (nowMs - statsStartMs >= kStatsPeriodMs) {
        const float hz = statsSamples * 1000.0f / (nowMs - statsStartMs);
        hostLog("#hz %.1f overruns %u", hz, (unsigned)statsOverruns);
        statsStartMs = nowMs;
        statsSamples = statsOverruns = 0;
    }
}
