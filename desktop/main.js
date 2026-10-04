// Phase Escape, desktop build: the web game in its own window, with Web
// Bluetooth and Web Serial wired up so the ESP32 controller works without a
// browser, wirelessly or over a USB cable.

const { app, BrowserWindow, dialog, session } = require('electron');
const path = require('node:path');

// USB-serial bridges seen on ESP32 boards (same list as the game):
// Silicon Labs CP210x, WCH CH340, FTDI, Espressif native USB.
const ESP32_VENDORS = new Set([0x10c4, 0x1a86, 0x0403, 0x303a]);

/** The controller's Bluetooth name (firmware kBleName) and how long to scan for it. */
const CONTROLLER_NAME = 'PhaseEscape';
const BLUETOOTH_SCAN_MS = 15000;

/** Electron reports USB vendor ids as decimal strings; -1 for non-USB ports (e.g. Bluetooth). */
function vendorOf(port) {
  const v = Number.parseInt(port.vendorId ?? '', 10);
  return Number.isFinite(v) ? v : -1;
}

function portLabel(port) {
  return port.displayName ? `${port.displayName} (${port.portName})` : port.portName;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#05060a',
    title: 'Phase Escape',
    icon: path.join(__dirname, 'icon.ico'),
    // The menu (Alt) keeps F11 full screen, reload and zoom.
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Electron has no built-in serial port picker, so choose here: the ESP32
  // automatically if it is the only one, otherwise ask.
  win.webContents.session.on('select-serial-port', async (event, portList, _webContents, callback) => {
    event.preventDefault();
    const boards = portList.filter((p) => ESP32_VENDORS.has(vendorOf(p)));
    if (boards.length === 1) {
      callback(boards[0].portId);
      return;
    }
    const candidates = boards.length > 0 ? boards : portList.filter((p) => vendorOf(p) !== -1);
    if (candidates.length === 0) {
      await dialog.showMessageBox(win, {
        type: 'info',
        title: 'No controller found',
        message: 'No ESP32 controller found.',
        detail: 'Plug the board in with a data USB cable, close any serial monitor that is using it, and try again.',
      });
      callback('');
      return;
    }
    const labels = candidates.map(portLabel);
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Choose the controller',
      message: 'Which serial port is the controller on?',
      buttons: [...labels, 'Cancel'],
      cancelId: labels.length,
    });
    callback(response < candidates.length ? candidates[response].portId : '');
  });

  // Nor is there a Bluetooth chooser. The game asks only for devices offering
  // the controller's service (or named PhaseEscape), so take the first one the
  // scan finds, preferring the name. The event repeats as the scan finds more;
  // keep the latest callback. Give up after BLUETOOTH_SCAN_MS.
  let bluetoothPick = null;
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    if (!bluetoothPick) {
      const pick = { callback, timer: null };
      pick.timer = setTimeout(() => {
        if (bluetoothPick !== pick) return;
        bluetoothPick = null;
        pick.callback('');
        void dialog.showMessageBox(win, {
          type: 'info',
          title: 'No controller found',
          message: 'No Bluetooth controller found.',
          detail: 'Switch the controller on (fresh batteries help), keep it nearby, check Bluetooth is on in Windows, and try again.',
        });
      }, BLUETOOTH_SCAN_MS);
      bluetoothPick = pick;
    }
    bluetoothPick.callback = callback;
    const match = devices.find((d) => d.deviceName === CONTROLLER_NAME) ?? devices[0];
    if (match) {
      clearTimeout(bluetoothPick.timer);
      bluetoothPick = null;
      callback(match.deviceId);
    }
  });

  win.loadFile(path.join(__dirname, 'web', 'index.html'));
}

// One copy at a time: two windows would fight over the controller's port.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    // Allow Web Serial (and no other permission) for the game. Web Bluetooth is
    // not one of these permissions: it is gated by 'select-bluetooth-device' above.
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'serial');
    session.defaultSession.setDevicePermissionHandler((details) => details.deviceType === 'serial');
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
