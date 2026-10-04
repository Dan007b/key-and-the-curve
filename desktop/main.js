// Phase Escape, desktop build: the web game in its own window, with Web
// Bluetooth and Web Serial wired up so the ESP32 controller works without a
// browser, wirelessly or over a USB cable.

const { app, BrowserWindow, dialog, session } = require('electron');
const path = require('node:path');

// USB-serial bridges seen on ESP32 boards (same list as the game):
// Silicon Labs CP210x, WCH CH340, FTDI, Espressif native USB.
const ESP32_VENDORS = new Set([0x10c4, 0x1a86, 0x0403, 0x303a]);

/** Set PHASE_ESCAPE_DEBUG=1 to log device selection to the console. */
function debug(...args) {
  if (process.env.PHASE_ESCAPE_DEBUG) console.log('[phase-escape]', ...args);
}

/** The controller's Bluetooth name (firmware kBleName), and how long to search for it. */
const CONTROLLER_NAME = 'PhaseEscape';
const BLUETOOTH_SEARCH_MS = 20000;

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
  // the controller's service (or named PhaseEscape), so every device listed is
  // a controller: take the first, preferring the name (the name arrives in the
  // scan response, so it can be missing at first). The event repeats as the
  // scan finds devices; keep the latest callback. Electron sometimes ends a
  // fruitless search itself (after ~10 s) and sometimes keeps going forever,
  // so give up after BLUETOOTH_SEARCH_MS: the game then shows "Controller not
  // found" with a Search again button. (A first search on Windows has taken
  // up to ~9 s to find the controller; later ones are near-instant.) Requests
  // can't be told apart here, so if Electron ends one early and you search
  // again at once, the new one may get less time; it then finds the cached
  // controller almost immediately anyway.
  let search = null;
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    debug('select-bluetooth-device', devices.map((d) => `${d.deviceName || '(no name)'} ${d.deviceId}`));
    if (!search) {
      const s = { callback, timer: null };
      s.timer = setTimeout(() => {
        if (search !== s) return;
        search = null;
        debug('search timed out');
        s.callback('');
      }, BLUETOOTH_SEARCH_MS);
      search = s;
    }
    search.callback = callback;
    const match = devices.find((d) => d.deviceName === CONTROLLER_NAME) ?? devices[0];
    if (match) {
      clearTimeout(search.timer);
      search = null;
      callback(match.deviceId);
    }
  });
  // A search that ended without us (cancelled by Electron, or the page reloaded) must not leave a stale timer behind.
  win.webContents.on('did-start-navigation', () => {
    if (search) clearTimeout(search.timer);
    search = null;
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
