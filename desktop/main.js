// The Key and the Curve, desktop build: the web game in its own window,
// with Web Serial wired up so the ESP32 controller works without a browser.

const { app, BrowserWindow, dialog, session } = require('electron');
const path = require('node:path');

// USB-serial bridges seen on ESP32 boards (same list as the game):
// Silicon Labs CP210x, WCH CH340, FTDI, Espressif native USB.
const ESP32_VENDORS = new Set([0x10c4, 0x1a86, 0x0403, 0x303a]);

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
    title: 'The Key and the Curve',
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
    // Allow Web Serial (and nothing else) for the game.
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'serial');
    session.defaultSession.setDevicePermissionHandler((details) => details.deviceType === 'serial');
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
