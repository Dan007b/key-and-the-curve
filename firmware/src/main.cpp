// The Key and the Curve: controller firmware.
//
// Phase 0 placeholder: proves the toolchain builds and the serial link works.
// Phase 1 replaces this with the BNO055 stream described in CLAUDE.md §5.
// No GPIO pins are used yet; they will be added once Danny confirms them.

#include <Arduino.h>

// Must match monitor_speed in platformio.ini and the game's Web Serial baud.
static constexpr uint32_t kBaud = 921600;

void setup() {
    Serial.begin(kBaud);
}

void loop() {
    // Lines starting with '#' are debug output and ignored by the game's parser.
    Serial.println("#alive");
    delay(1000);
}
