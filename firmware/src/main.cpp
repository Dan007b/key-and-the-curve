// The Key and the Curve: controller firmware.
//
// Phase 0 placeholder: proves the toolchain builds and USB CDC works.
// Phase 1 replaces this with the BNO055 stream described in CLAUDE.md §5.
// No GPIO pins are used yet; they will be added once Danny confirms them.

#include <Arduino.h>

void setup() {
    Serial.begin(115200);
}

void loop() {
    // Lines starting with '#' are debug output and ignored by the game's parser.
    Serial.println("#alive");
    delay(1000);
}
