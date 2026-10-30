import { app, BrowserWindow, net, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

let mainWindow;
let localServer;
let localUrl;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      const userDataDir = app.getPath('userData');
      const databasePath = path.join(userDataDir, 'rendimentos.db');
      if (!fs.existsSync(databasePath)) {
        const initialDatabase = path.join(app.getAppPath(), 'data', 'rendimentos.db');
        if (fs.existsSync(initialDatabase)) fs.copyFileSync(initialDatabase, databasePath);
      }

      process.env.LASTRO_DB_PATH = databasePath;
      const { startServer } = await import('../server.js');
      const started = await startServer(0, '127.0.0.1', { fetch: net.fetch.bind(net) });
      localServer = started.server;
      localUrl = started.url;
      createWindow();
    } catch (error) {
      console.error('Não foi possível iniciar o Lastro.app:', error);
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (localServer?.listening) localServer.close();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 920,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0B1220',
    title: 'Lastro.app',
    icon: path.join(app.getAppPath(), 'public', 'favicon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(localUrl)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(localUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(localUrl);
}
