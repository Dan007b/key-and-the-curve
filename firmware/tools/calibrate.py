"""Guided BNO055 calibration: shows live status, saves to the ESP32's flash
when fully calibrated, then reboots the board to confirm it loads back.

    & "$env:USERPROFILE\\.platformio\\penv\\Scripts\\python.exe" tools\\calibrate.py COM9

Close any serial monitor first; only one program can hold the port.
Press Ctrl+C to quit without saving.
"""

import sys
import time

import serial

BAUD = 921600
# How long all four digits must stay at 3 before saving, so a momentary 3 doesn't count.
STABLE_S = 1.0

HINTS = {
    "gyr": "GYRO: set the controller down and keep it completely still for a few seconds.",
    "mag": "MAG: move it slowly through the air in a figure-8, away from metal and magnets.",
    "acc": "ACCEL: hold it still in ~6 orientations for 3 s each (flat, upside down, each edge).",
    "sys": "SYSTEM: keep moving it gently, then hold still; this follows once the others are 3.",
}


def open_port(name):
    # DTR/RTS low before opening, so the DevKitC auto-reset circuit doesn't fire.
    port = serial.Serial()
    port.port = name
    port.baudrate = BAUD
    port.timeout = 0.2
    port.dtr = False
    port.rts = False
    port.open()
    return port


def read_line(port):
    return port.readline().decode("ascii", errors="replace").strip()


def reboot_and_check(port):
    """Pulse EN via RTS and wait for the boot message about stored calibration."""
    print("\nRebooting the board to check the calibration loads back...")
    port.rts = True
    time.sleep(0.1)
    port.rts = False
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        line = read_line(port)
        if line.startswith("#cal"):
            print(f"  board says: {line}")
            return "loaded" in line
    print("  no calibration message seen after reboot")
    return False


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    port = open_port(sys.argv[1])
    print("Watching calibration. Digits go 0 (none) to 3 (done). Ctrl+C to quit.\n")

    all_good_since = None
    last_print = 0.0
    while True:
        line = read_line(port)
        if not line:
            continue
        if line.startswith("#"):
            if not line.startswith("#hz"):
                print(f"\n  board says: {line}")
            continue
        fields = line.split(",")
        if len(fields) != 13:
            continue
        try:
            digits = f"{int(fields[11]):04d}"
        except ValueError:
            continue
        levels = dict(zip(("sys", "gyr", "acc", "mag"), (int(d) for d in digits)))

        now = time.monotonic()
        if all(v == 3 for v in levels.values()):
            all_good_since = all_good_since or now
            if now - all_good_since >= STABLE_S:
                break
        else:
            all_good_since = None

        if now - last_print > 0.25:
            last_print = now
            todo = next((k for k in ("gyr", "mag", "acc", "sys") if levels[k] < 3), None)
            hint = HINTS[todo] if todo else "All 3! Hold still..."
            status = "  ".join(f"{k} {v}" for k, v in levels.items())
            print(f"\r{status}   {hint:<90}", end="", flush=True)

    print("\n\nFully calibrated. Saving to the ESP32's flash...")
    port.write(b"S\n")
    deadline = time.monotonic() + 3
    saved = False
    while time.monotonic() < deadline:
        line = read_line(port)
        if line.startswith("#cal"):
            print(f"  board says: {line}")
            saved = "saved to NVS" in line
            break
    if not saved:
        print("Save failed; run this again.")
        sys.exit(1)

    ok = reboot_and_check(port)
    port.close()
    print("\nDONE: calibration is stored and restored on boot." if ok
          else "\nSaved, but couldn't confirm the reload. Check the monitor after a reboot.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped without saving.")
