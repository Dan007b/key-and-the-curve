"""Validate the controller's serial stream for a few seconds and report.

Checks that every '$' line has 13 well-formed fields, that the quaternion is
unit length, that gravity is ~9.8 m/s^2, and measures the sample rate.

Run with PlatformIO's bundled Python (it already has pyserial):

    & "$env:USERPROFILE\\.platformio\\penv\\Scripts\\python.exe" tools\\check_stream.py COM3

Close any serial monitor first; only one program can hold the port.
"""

import math
import sys
import time

import serial

BAUD = 921600
DURATION_S = 5.0


def check_line(fields):
    """Return an error string for a malformed sample, or None if it is fine."""
    if len(fields) != 13 or fields[0] != "$":
        return f"expected 13 fields, got {len(fields)}"
    try:
        q = [float(f) for f in fields[1:5]]
        g = [float(f) for f in fields[5:8]]
        [float(f) for f in fields[8:11]]
        cal = int(fields[11])
        btn = int(fields[12])
    except ValueError as e:
        return f"parse error: {e}"
    qn = math.sqrt(sum(c * c for c in q))
    if abs(qn - 1.0) > 0.01:
        return f"quaternion norm {qn:.4f}"
    gn = math.sqrt(sum(c * c for c in g))
    if not 8.0 < gn < 11.5:
        return f"gravity magnitude {gn:.2f} m/s^2"
    if any(int(d) > 3 for d in f"{cal:04d}") or not 0 <= btn <= 3:
        return f"bad cal/btn {cal}/{btn}"
    return None


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    # dsrdtr/rtscts off and DTR/RTS low so opening the port does not reset the board.
    port = serial.Serial()
    port.port = sys.argv[1]
    port.baudrate = BAUD
    port.timeout = 0.5
    port.dtr = False
    port.rts = False
    port.open()

    port.reset_input_buffer()
    port.readline()  # discard a probably-partial first line
    good, bad, debug = 0, 0, []
    last = None
    t0 = time.monotonic()
    while time.monotonic() - t0 < DURATION_S:
        raw = port.readline().decode("ascii", errors="replace").strip()
        if not raw:
            continue
        if raw.startswith("#"):
            debug.append(raw)
            continue
        err = check_line(raw.split(","))
        if err:
            bad += 1
            print(f"BAD  {err}: {raw}")
        else:
            good += 1
            last = raw
    elapsed = time.monotonic() - t0
    port.close()

    for line in debug:
        print(f"     {line}")
    print(f"last sample: {last}")
    print(f"{good} good, {bad} bad lines in {elapsed:.1f} s -> {good / elapsed:.1f} Hz")
    ok = bad == 0 and 90 <= good / elapsed <= 110
    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
