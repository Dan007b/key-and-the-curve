# The Key and the Curve

Roll a marble through a hyperbolic {5,4} maze while carrying a 4D tesseract key. Gates open only when the key's orientation fits, and in curved space the path you take rotates the key.

Built for the "Beyond Euclid: Interactive Experiences in Impossible Geometries" challenge. Full docs come in Phase 8.

## Layout

- `game/`: Vite + TypeScript + Three.js browser game
- `firmware/`: PlatformIO project for the ESP32-S3 + BNO055 controller
- `docs/`: `MATH.md`, `HARDWARE.md`

## Quick start (PowerShell)

```powershell
cd game
npm install
npm run dev     # http://localhost:5173 (use Chrome or Edge for Web Serial)
npm test
```

Firmware (wiring, calibration and protocol are in [docs/HARDWARE.md](docs/HARDWARE.md)):

```powershell
cd firmware
pio run
pio run -t upload
pio device monitor
```
