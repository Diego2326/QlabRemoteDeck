'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const events = ['config', 'status', 'workspaces', 'cueLists', 'currentCueList', 'playhead', 'running', 'event', 'action', 'commandAck', 'log'];

contextBridge.exposeInMainWorld('qdeck', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  connect: (config) => ipcRenderer.invoke('qlab:connect', config),
  disconnect: () => ipcRenderer.invoke('qlab:disconnect'),
  action: (action, payload = {}) => ipcRenderer.invoke('qlab:action', action, payload),
  fullscreen: () => ipcRenderer.invoke('app:fullscreen'),
  quit: () => ipcRenderer.invoke('app:quit'),
  on: (event, callback) => {
    if (!events.includes(event)) throw new Error(`Evento no permitido: ${event}`);
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(`qlab:${event}`, handler);
    return () => ipcRenderer.removeListener(`qlab:${event}`, handler);
  }
});
