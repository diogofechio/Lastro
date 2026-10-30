import { app, BrowserWindow, ipcMain, net, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

let mainWindow;
let compactWindow;
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
      ipcMain.handle('lastro:open-compact', () => openCompactWindow());
      ipcMain.handle('lastro:open-main', () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow();
          return true;
        }
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        return true;
      });
      ipcMain.handle('lastro:close-compact', event => {
        const owner = BrowserWindow.fromWebContents(event.sender);
        if (owner === compactWindow) owner.close();
      });
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
      preload: path.join(app.getAppPath(), 'desktop', 'preload.cjs'),
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

function openCompactWindow() {
  if (compactWindow && !compactWindow.isDestroyed()) {
    if (compactWindow.isMinimized()) compactWindow.restore();
    compactWindow.show();
    compactWindow.focus();
    return true;
  }
  compactWindow = new BrowserWindow({
    width: 420,
    height: 620,
    minWidth: 360,
    minHeight: 480,
    show: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: '#0B1220',
    title: 'Lastro · Visão rápida',
    icon: path.join(app.getAppPath(), 'public', 'favicon.ico'),
    webPreferences: {
      preload: path.join(app.getAppPath(), 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  compactWindow.once('ready-to-show', () => compactWindow?.show());
  compactWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  compactWindow.on('closed', () => { compactWindow = null; });
  compactWindow.loadURL(new URL('/compact.html', localUrl).href);
  return true;
}
