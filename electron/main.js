const { app, BrowserWindow } = require('electron');
const path = require('path');
const net = require('net');
const { createServer } = require('http');
const next = require('next');

const isDev = !app.isPackaged;
let nextServer;
let httpServer;
let mainWindow;

const findOpenPort = (startPort) =>
  new Promise((resolve) => {
    const tryPort = (port) => {
      const tester = net
        .createServer()
        .once('error', () => tryPort(port + 1))
        .once('listening', () => tester.close(() => resolve(port)))
        .listen(port, '127.0.0.1');
    };
    tryPort(startPort);
  });

const createMainWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    await mainWindow.loadURL('http://localhost:3000');
    return;
  }

  const port = await findOpenPort(3000);
  const appDir = app.getAppPath();
  nextServer = next({ dev: false, dir: appDir });
  const handle = nextServer.getRequestHandler();
  await nextServer.prepare();

  httpServer = createServer((req, res) => handle(req, res));
  await new Promise((resolve) => httpServer.listen(port, '127.0.0.1', resolve));

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.whenReady().then(createMainWindow);

app.on('before-quit', async () => {
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  if (nextServer) {
    await nextServer.close();
  }
});
