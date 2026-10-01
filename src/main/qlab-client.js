'use strict';

const net = require('node:net');
const { EventEmitter } = require('node:events');
const { encodeMessage, decodePacket, slipEncode, SlipDecoder } = require('./osc');

const DEFAULT_CONFIG = {
  host: '',
  port: 53000,
  passcode: '',
  workspaceId: '',
  workspaceName: '',
  autoConnect: true,
  demoMode: false
};

class QLabClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.socket = null;
    this.workspace = null;
    this.state = 'disconnected';
    this.reconnectTimer = null;
    this.refreshTimer = null;
    this.reconnectAttempt = 0;
    this.intentionalClose = false;
    this.pendingActions = new Map();
    this.cueLists = [];
    this.slip = new SlipDecoder((frame) => this.onFrame(frame));
  }

  setState(state, detail = '') {
    this.state = state;
    this.emit('status', { state, detail, workspace: this.workspace });
  }

  connect(config = this.config) {
    this.disconnect(false);
    this.config = { ...this.config, ...config };
    if (this.config.demoMode) return this.startDemo();
    if (!this.config.host) return this.setState('disconnected', 'Configura la IP de la Mac');

    this.intentionalClose = false;
    this.setState('connecting', `Conectando con ${this.config.host}:53000`);
    // QLab siempre conserva el puerto 53000 para mensajes de aplicación. Desde
    // allí descubrimos el puerto real del workspace, aunque este sea personalizado.
    this.openSocket(53000, () => {
      this.reconnectAttempt = 0;
      this.setState('discovering', 'Buscando workspaces de QLab');
      this.send('/workspaces');
    });
  }

  openSocket(port, onConnect) {
    if (this.socket) this.socket.destroy();
    this.slip = new SlipDecoder((frame) => this.onFrame(frame));
    const socket = net.createConnection({ host: this.config.host, port: Number(port) });
    this.socket = socket;
    this.connectedPort = Number(port);
    socket.setKeepAlive(true, 3000);
    socket.setNoDelay(true);
    socket.on('connect', onConnect);
    socket.on('data', (chunk) => this.slip.push(chunk));
    socket.on('error', (error) => {
      if (this.socket === socket) this.setState('error', friendlyError(error));
    });
    socket.on('close', () => {
      // Ignora el cierre de un socket reemplazado al cambiar de puerto.
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearRefresh();
      if (!this.intentionalClose) this.scheduleReconnect();
      else this.setState('disconnected', 'Desconectado');
    });
  }

  disconnect(intentional = true) {
    this.intentionalClose = intentional;
    clearTimeout(this.reconnectTimer);
    this.clearRefresh();
    if (this.socket) this.socket.destroy();
    this.socket = null;
    this.workspace = null;
    if (intentional) this.setState('disconnected', 'Desconectado');
  }

  scheduleReconnect() {
    const seconds = Math.min(12, 2 ** Math.min(this.reconnectAttempt++, 3));
    this.setState('reconnecting', `Reconectando en ${seconds} s`);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), seconds * 1000);
  }

  clearRefresh() {
    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  send(address, ...args) {
    if (this.config.demoMode) return this.demoAction(address, args);
    if (!this.socket || this.socket.destroyed) return false;
    this.socket.write(slipEncode(encodeMessage(address, args)));
    return true;
  }

  sendAction(action, address, ...args) {
    if (this.config.demoMode) {
      const sent = this.send(address, ...args);
      queueMicrotask(() => this.emit('commandAck', { action, address, status: 'ok', latency: 0 }));
      return sent;
    }
    const queue = this.pendingActions.get(address) || [];
    queue.push({ action, sentAt: Date.now() });
    this.pendingActions.set(address, queue);
    return this.send(address, ...args);
  }

  scoped(path) {
    return this.workspace ? `/workspace/${this.workspace.uniqueID}${path}` : path;
  }

  action(action, payload = {}) {
    const cueId = payload.cueId;
    const amount = Math.max(0.1, Math.min(12, Number(payload.amount) || 1));
    const command = (address, ...args) => this.sendAction(action, address, ...args);
    const cue = (cueCommand) => cueId && command(this.scoped(`/cue_id/${cueId}/${cueCommand}`));
    const adjustLevel = (target, direction) => command(this.scoped(`/cue/${target}/level/0/0/${direction}/live`), amount);
    const adjustCueLevel = (direction) => cueId && command(this.scoped(`/cue_id/${cueId}/level/0/0/${direction}/live`), amount);
    const actions = {
      go: () => command(this.scoped('/go')),
      stopAll: () => command(this.scoped('/stop')),
      hardStopAll: () => command(this.scoped('/hardStop')),
      panic: () => command(this.scoped('/panic')),
      pauseAll: () => command(this.scoped('/pause')),
      resumeAll: () => command(this.scoped('/resume')),
      resetAll: () => command(this.scoped('/reset')),
      next: () => command(this.scoped('/playhead/next')),
      previous: () => command(this.scoped('/playhead/previous')),
      nextSequence: () => command(this.scoped('/playhead/nextSequence')),
      previousSequence: () => command(this.scoped('/playhead/previousSequence')),
      setCurrentCueList: () => cueId && command(this.scoped(`/currentCueListID/${cueId}`)),
      setPlayhead: () => cueId && command(this.scoped(`/playheadID/${cueId}`)),
      startCue: () => cue('start'),
      previewCue: () => cue('preview'),
      stopCue: () => cue('stop'),
      hardStopCue: () => cue('hardStop'),
      togglePauseCue: () => cue('togglePause'),
      loadCue: () => cue('loadAndSetPlayhead'),
      activeVolumeUp: () => adjustLevel('active', '+'),
      activeVolumeDown: () => adjustLevel('active', '-'),
      cueVolumeUp: () => adjustCueLevel('+'),
      cueVolumeDown: () => adjustCueLevel('-'),
      refresh: () => this.refresh(true)
    };
    const handler = actions[action];
    if (!handler) return false;
    const result = handler();
    this.emit('action', { action, payload });
    if (!['next', 'previous'].includes(action)) setTimeout(() => this.refresh(false), 180);
    return result !== false;
  }

  onFrame(frame) {
    try {
      for (const message of decodePacket(frame)) this.onMessage(message);
    } catch (error) {
      this.emit('log', { level: 'error', text: `Respuesta OSC inválida: ${error.message}` });
    }
  }

  onMessage(message) {
    this.emit('message', message);
    if (message.address.startsWith('/reply/')) return this.onReply(message);
    if (message.address.startsWith('/qlab/event/')) {
      this.emit('event', { address: message.address, args: message.args });
      if (message.address.includes('/playhead')) this.refreshPlayhead();
      if (/cue\/(start|stop)|\/go|panic|reset/.test(message.address)) this.refreshRunning();
    }
  }

  onReply(message) {
    let body = message.args[0];
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* connect can return a plain value */ }
    }
    const address = body?.address || message.address.replace(/^\/reply/, '');
    const data = body?.data ?? body;
    const status = body?.status;

    let pendingAddress = address;
    let pending = this.pendingActions.get(address);
    if (!pending?.length) {
      // Algunos setters codifican el valor al final de la dirección, pero QLab
      // responde usando la dirección base (p. ej. currentCueListID/{id}).
      pendingAddress = [...this.pendingActions.keys()].find((candidate) => candidate.startsWith(`${address}/`));
      pending = pendingAddress ? this.pendingActions.get(pendingAddress) : null;
    }
    let acknowledgedAction = false;
    if (pending?.length) {
      const command = pending.shift();
      if (!pending.length) this.pendingActions.delete(pendingAddress);
      this.emit('commandAck', { action: command.action, address, status: status || 'ok', latency: Date.now() - command.sentAt });
      acknowledgedAction = true;
    }

    if (address === '/workspaces') {
      const workspaces = Array.isArray(data) ? data : [];
      this.emit('workspaces', workspaces);
      const chosen = workspaces.find((item) => item.uniqueID === this.config.workspaceId)
        || workspaces.find((item) => item.displayName === this.config.workspaceName)
        || workspaces[0];
      if (!chosen) return this.setState('error', 'QLab no tiene ningún workspace abierto');
      this.workspace = chosen;
      const authorize = () => {
        this.setState('authorizing', `Autorizando ${chosen.displayName}`);
        const connectPath = `/workspace/${chosen.uniqueID}/connect`;
        if (this.config.passcode) this.send(connectPath, String(this.config.passcode));
        else this.send(connectPath);
      };
      const workspacePort = Number(chosen.port || this.config.port || 53000);
      if (workspacePort !== this.connectedPort) {
        this.setState('connecting', `Abriendo workspace en puerto ${workspacePort}`);
        this.openSocket(workspacePort, authorize);
      } else authorize();
      return;
    }

    if (address.endsWith('/connect')) {
      // QLab 5.6 incluye los permisos concedidos, por ejemplo
      // "ok:view|edit|control"; versiones anteriores pueden devolver solo "ok".
      const accepted = status === 'ok' && (
        data === true || data == null || (typeof data === 'string' && (data === 'ok' || data.startsWith('ok:')))
      );
      if (accepted) this.onAuthorized();
      else this.setState('denied', data === 'badpass' ? 'Código de acceso incorrecto' : 'QLab rechazó el acceso');
      return;
    }

    if (status === 'denied') {
      this.setState('denied', 'Permisos insuficientes en QLab');
      return;
    }
    if (status === 'error') {
      // Los Cue Carts son listas válidas, pero no tienen playhead. Eso no debe
      // convertirse en un objeto de error usado como ID por la interfaz.
      if (address.endsWith('/playheadID')) this.emit('playhead', null);
      else if (!acknowledgedAction) this.emit('log', { level: 'error', text: `QLab: error en ${address}` });
      return;
    }
    if (address.endsWith('/cueLists')) {
      this.cueLists = Array.isArray(data) ? data : [];
      this.emit('cueLists', this.cueLists);
    }
    else if (address.endsWith('/currentCueListID')) {
      this.emit('currentCueList', data);
      const current = this.cueLists.find((list) => list.uniqueID === data);
      if (data && data !== 'none' && current?.type !== 'Cart') this.send(this.scoped(`/cue_id/${data}/playheadID`));
    } else if (address.endsWith('/playheadID')) this.emit('playhead', data);
    else if (address.endsWith('/runningOrPausedCues/shallow')) this.emit('running', data || []);
  }

  onAuthorized() {
    this.setState('connected', `Conectado a ${this.workspace.displayName}`);
    this.send('/alwaysReply', 1);
    this.send('/updates', 1);
    this.send(this.scoped('/listen'));
    this.refresh(true);
    this.clearRefresh();
    let ticks = 0;
    this.refreshTimer = setInterval(() => {
      this.refreshRunning();
      this.refreshPlayhead();
      if (++ticks % 10 === 0) this.send(this.scoped('/cueLists'));
    }, 1500);
  }

  refresh(full = false) {
    if (!this.workspace && !this.config.demoMode) return;
    if (full) this.send(this.scoped('/cueLists'));
    this.refreshRunning();
    this.refreshPlayhead();
  }

  refreshRunning() {
    this.send(this.scoped('/runningOrPausedCues/shallow'));
  }

  refreshPlayhead() {
    this.send(this.scoped('/currentCueListID'));
  }

  startDemo() {
    this.intentionalClose = false;
    this.workspace = { uniqueID: 'DEMO', displayName: 'Evento de demostración' };
    this.demo = createDemo();
    this.setState('demo', 'Modo demostración — no envía comandos');
    queueMicrotask(() => {
      this.emit('cueLists', this.demo.lists);
      this.emit('currentCueList', this.demo.lists[0].uniqueID);
      this.emit('playhead', this.demo.playheadId);
      this.emit('running', this.demo.running);
    });
  }

  demoAction(address) {
    if (!this.demo) return;
    const cues = this.demo.lists[0].cues;
    let index = cues.findIndex((cue) => cue.uniqueID === this.demo.playheadId);
    const targetedCue = address.match(/\/cue_id\/([^/]+)/)?.[1];
    const requestedPlayhead = address.match(/\/playheadID\/([^/]+)$/)?.[1];
    if (address.endsWith('/go')) {
      const cue = cues[index];
      if (cue) this.demo.running = [{ ...cue }];
      this.demo.playheadId = cues[Math.min(index + 1, cues.length - 1)]?.uniqueID;
    } else if (requestedPlayhead && cues.some((cue) => cue.uniqueID === requestedPlayhead)) {
      this.demo.playheadId = requestedPlayhead;
    } else if (address.endsWith('/playhead/next')) {
      this.demo.playheadId = cues[Math.min(index + 1, cues.length - 1)]?.uniqueID;
    } else if (address.endsWith('/playhead/previous')) {
      this.demo.playheadId = cues[Math.max(index - 1, 0)]?.uniqueID;
    } else if (targetedCue && /\/(start|preview)$/.test(address)) {
      const cue = cues.find((item) => item.uniqueID === targetedCue);
      if (cue && !this.demo.running.some((item) => item.uniqueID === targetedCue)) this.demo.running.push({ ...cue });
    } else if (targetedCue && /\/(stop|hardStop)$/.test(address)) {
      this.demo.running = this.demo.running.filter((cue) => cue.uniqueID !== targetedCue);
    } else if (/\/(stop|hardStop|panic|reset)$/.test(address)) this.demo.running = [];
    this.emit('playhead', this.demo.playheadId);
    this.emit('running', this.demo.running);
  }
}

function friendlyError(error) {
  if (error.code === 'ECONNREFUSED') return 'La Mac rechazó la conexión. Revisa QLab y el puerto.';
  if (error.code === 'EHOSTUNREACH' || error.code === 'ENETUNREACH') return 'La Mac no es accesible en esta red.';
  if (error.code === 'ETIMEDOUT') return 'La conexión agotó el tiempo de espera.';
  return error.message;
}

function createDemo() {
  const cue = (id, number, name, type, colorName = 'none') => ({ uniqueID: id, number, name, listName: name, type, colorName, armed: true, flagged: false });
  const cues = [
    cue('c1', '1', 'Preset de sala', 'Group', 'blue'),
    cue('c2', '2', 'Bienvenida — música ambiente', 'Audio', 'green'),
    cue('c3', '3', 'Entrada del presentador', 'Group', 'purple'),
    cue('c4', '3.1', 'Video de apertura', 'Video', 'purple'),
    cue('c5', '4', 'Presentación principal', 'Group', 'yellow'),
    cue('c6', '5', 'Transición a preguntas', 'Fade', 'orange'),
    cue('c7', '6', 'Cierre y créditos', 'Video', 'red'),
    cue('c8', '7', 'Música de salida', 'Audio', 'green')
  ];
  return { lists: [{ ...cue('list1', 'MAIN', 'Show principal', 'Cue List'), cues }], playheadId: 'c3', running: [cues[1]] };
}

module.exports = { QLabClient, DEFAULT_CONFIG };
