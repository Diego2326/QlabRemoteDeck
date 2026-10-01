'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { QLabClient, DEFAULT_CONFIG } = require('./qlab-client');

let window;
let client;
let config = DEFAULT_CONFIG;

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
  } catch {
    config = { ...DEFAULT_CONFIG };
  }
  if (process.env.QDECK_DEMO === '1') config = { ...config, demoMode: true, autoConnect: true };
  return config;
}

function saveConfig(next) {
  config = { ...config, ...next, port: Number(next.port || config.port || 53000) };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  return config;
}

function send(channel, payload) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function bindClient() {
  client = new QLabClient(config);
  for (const event of ['status', 'workspaces', 'cueLists', 'currentCueList', 'playhead', 'running', 'event', 'action', 'commandAck', 'log']) {
    client.on(event, (payload) => send(`qlab:${event}`, payload));
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#090d12',
    autoHideMenuBar: true,
    fullscreen: process.argv.includes('--fullscreen'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.loadFile(path.join(__dirname, '../renderer/index.html'));
  window.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') window.setFullScreen(!window.isFullScreen());
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.once('did-finish-load', () => {
    send('qlab:config', config);
    if (config.autoConnect && (config.host || config.demoMode)) client.connect(config);
    if (process.env.QDECK_SCREENSHOT) {
      setTimeout(async () => {
        if (process.env.QDECK_SCREENSHOT_VIEW) {
          const view = JSON.stringify(process.env.QDECK_SCREENSHOT_VIEW);
          await window.webContents.executeJavaScript(`
            document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element.id === 'view-' + ${view}));
            document.querySelectorAll('.tab').forEach((element) => element.classList.toggle('active', element.dataset.view === ${view}));
          `);
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        if (process.env.QDECK_SCREENSHOT_KIND === 'cart') {
          await window.webContents.executeJavaScript(`document.querySelector('#cue-list-carts .cue-row')?.click()`);
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        if (process.env.QDECK_SCREENSHOT_THEME === 'dark') {
          await window.webContents.executeJavaScript(`document.body.classList.add('dark-theme')`);
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        const image = await window.webContents.capturePage();
        fs.writeFileSync(process.env.QDECK_SCREENSHOT, image.toPNG());
        app.quit();
      }, 2200);
    }
  });
}

app.whenReady().then(() => {
  loadConfig();
  bindClient();
  createWindow();

  ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:save', (_event, next) => {
    const saved = saveConfig(next);
    client.connect(saved);
    return saved;
  });
  ipcMain.handle('qlab:connect', (_event, next) => {
    if (next) saveConfig(next);
    client.connect(config);
    return true;
  });
  ipcMain.handle('qlab:disconnect', () => client.disconnect(true));
  ipcMain.handle('qlab:action', (_event, action, payload) => client.action(action, payload));
  ipcMain.handle('app:fullscreen', () => {
    window.setFullScreen(!window.isFullScreen());
    return window.isFullScreen();
  });
  ipcMain.handle('app:quit', () => app.quit());
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  if (client) client.disconnect(true);
});
