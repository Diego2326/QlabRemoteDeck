'use strict';

const state = {
  config: {},
  status: { state: 'disconnected', detail: 'Desconectado' },
  workspaces: [],
  lists: [],
  currentListId: null,
  activeKind: 'list',
  selectedCollectionIds: { list: null, cart: null },
  playheadId: null,
  running: [],
  focusedIds: { list: null, cart: null },
  view: 'show',
  lastMessageAt: 0,
  showLocked: localStorage.getItem('qdeck-show-locked') === '1'
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const colorMap = {
  red: '#ff5f66', orange: '#ff9f52', yellow: '#f0cc56', green: '#43df82',
  blue: '#4ca5f8', purple: '#a57af3', magenta: '#ef6fbd', grey: '#73808a', gray: '#73808a', none: '#53606a'
};

function currentList(kind = state.activeKind) {
  const selectedId = state.selectedCollectionIds[kind];
  const selected = state.lists.find((list) => list.uniqueID === selectedId && collectionKind(list) === kind);
  if (selected) return selected;
  const qlabCurrent = state.lists.find((list) => list.uniqueID === state.currentListId && collectionKind(list) === kind);
  return qlabCurrent || collections(kind)[0] || null;
}

function collectionKind(list = currentList()) {
  return list?.type === 'Cart' ? 'cart' : 'list';
}

function collections(kind) {
  return state.lists.filter((list) => (list.type === 'Cart' ? 'cart' : 'list') === kind);
}

function selectCollection(list) {
  if (!list) return;
  const kind = collectionKind(list);
  state.activeKind = kind;
  state.selectedCollectionIds[kind] = list.uniqueID;
  // Un Cue Cart no puede convertirse en currentCueListID en QLab. Se mantiene
  // como un navegador independiente y sus cues se lanzan directamente por ID.
  if (kind === 'list') {
    state.currentListId = list.uniqueID;
    state.playheadId = null;
  }
  render();
  if (kind === 'list') act('setCurrentCueList', list.uniqueID);
}

function cycleCollection(kind, delta) {
  const available = collections(kind);
  if (!available.length) {
    toast(kind === 'cart' ? 'Este workspace no tiene Cue Carts' : 'Este workspace no tiene Cue Lists');
    return;
  }
  const index = available.findIndex((list) => list.uniqueID === state.selectedCollectionIds[kind]);
  const start = index < 0 ? (delta > 0 ? -1 : 0) : index;
  selectCollection(available[(start + delta + available.length) % available.length]);
}

function flattenCues(cues = [], depth = 0) {
  return cues.flatMap((cue) => [{ ...cue, depth }, ...flattenCues(cue.cues, depth + 1)]);
}

function visibleCues(kind = state.activeKind) {
  return flattenCues(currentList(kind)?.cues || []);
}

function focusedCue(kind = state.activeKind) {
  const cues = visibleCues(kind);
  return cues.find((cue) => cue.uniqueID === state.focusedIds[kind])
    || cues.find((cue) => kind === 'list' && cue.uniqueID === state.playheadId)
    || cues[0];
}

function playheadCue() {
  return visibleCues('list').find((cue) => cue.uniqueID === state.playheadId);
}

function isRunning(id) {
  return state.running.some((cue) => cue.uniqueID === id);
}

function render() {
  renderConnection();
  renderLock();
  renderCueList();
  renderStandby();
  renderRunning();
  renderWorkspacePicker();
  renderMixer();
}

function renderMixer() {
  const cue = focusedCue();
  $('#audio-active-count').textContent = state.running.length;
  $('#mixer-cue-name').textContent = cue
    ? `${cue.number || '—'} · ${cue.listName || cue.name || 'Sin nombre'}`
    : 'Sin cue seleccionado';
}

function renderLock() {
  document.body.classList.toggle('show-locked', state.showLocked);
  const button = $('#lock-button');
  button.classList.toggle('locked', state.showLocked);
  button.textContent = state.showLocked ? '🔒' : '🔓';
  button.title = state.showLocked ? 'Modo Show bloqueado' : 'Bloquear modo Show';
}

function renderConnection() {
  const button = $('#connection-button');
  const status = state.status.state;
  button.className = `connection ${status === 'connected' || status === 'demo' ? 'connected' : status === 'error' || status === 'denied' ? 'error' : status === 'disconnected' ? 'offline' : 'connecting'}`;
  const labels = { connected: state.status.workspace?.displayName || 'Conectado', demo: 'Demostración', disconnected: 'Desconectado', error: 'Error', denied: 'Acceso denegado', connecting: 'Conectando…', reconnecting: 'Reconectando…', discovering: 'Buscando…', authorizing: 'Autorizando…' };
  button.querySelector('span').textContent = labels[status] || status;
  button.title = state.status.detail || '';
  $('#latency-label').textContent = status === 'demo' ? 'DEMO' : status === 'connected' ? 'QLab online' : 'QLab offline';
}

function renderCueList() {
  renderCuePanel('list');
  renderCuePanel('cart');
}

function renderCuePanel(kind) {
  const list = currentList(kind);
  const picker = $(`#list-picker-${kind}`);
  picker.textContent = list?.listName || list?.name || (kind === 'cart' ? 'Sin Cue Cart' : 'Sin Cue List');
  $(`#${kind === 'cart' ? 'cart' : 'list'}-panel`).classList.toggle('active-panel', state.activeKind === kind);
  const cues = visibleCues(kind);
  const container = $(`#cue-list-${kind === 'cart' ? 'carts' : 'lists'}`);
  if (!cues.length) {
    container.innerHTML = `<div class="empty-state">${list ? 'Esta colección no tiene cues.' : kind === 'cart' ? 'No hay Cue Carts.' : 'No hay Cue Lists.'}</div>`;
    return;
  }
  container.innerHTML = cues.map((cue) => {
    const classes = ['cue-row', kind === 'list' && cue.uniqueID === state.playheadId ? 'playhead' : '', cue.uniqueID === state.focusedIds[kind] ? 'focused' : '', isRunning(cue.uniqueID) ? 'running' : ''].filter(Boolean).join(' ');
    const indent = 11 + (cue.depth || 0) * 13;
    return `<div class="${classes}" data-cue-id="${attr(cue.uniqueID)}" data-cue-kind="${kind}" tabindex="0" style="--cue-color:${colorMap[String(cue.colorName).toLowerCase()] || colorMap.none}">
      <span class="cue-stripe"></span><span class="cue-num">${escapeHtml(cue.number || '—')}</span>
      <span class="cue-info" style="padding-left:${indent}px"><strong class="cue-title">${escapeHtml(cue.listName || cue.name || 'Sin nombre')}</strong><span class="cue-sub">${escapeHtml(cue.type || 'Cue')}</span></span><span class="cue-state"></span>
    </div>`;
  }).join('');
  container.querySelectorAll('.cue-row').forEach((row) => {
    row.addEventListener('click', () => selectCue(row.dataset.cueId, row.dataset.cueKind));
    row.addEventListener('dblclick', () => {
      activateKind(row.dataset.cueKind);
      act(row.dataset.cueKind === 'cart' ? 'startCue' : 'setPlayhead', row.dataset.cueId);
    });
  });
}

function renderStandby() {
  const cues = visibleCues();
  const isCart = currentList()?.type === 'Cart';
  const cue = isCart ? focusedCue() : playheadCue();
  const index = cues.findIndex((item) => item.uniqueID === cue?.uniqueID);
  const next = index >= 0 ? cues[index + 1] : null;
  $('.standby-top .eyebrow').textContent = isCart ? 'CUE CART / SELECCIÓN' : 'LISTO / PLAYHEAD';
  $('#cue-number').textContent = cue?.number || '—';
  $('#cue-name').textContent = cue?.listName || cue?.name || (connected() ? (isCart ? 'Cue Cart vacío' : 'Sin cue en playhead') : 'Esperando conexión');
  $('#cue-meta').textContent = cue ? `${cue.armed === false ? 'DESARMADO · ' : ''}${currentList()?.listName || currentList()?.name || 'Cue list'}` : state.status.detail || 'Configura la dirección de tu Mac para comenzar.';
  $('#cue-type').textContent = cue?.type || '—';
  $('#next-cue').textContent = next ? `${next.number || '—'}  ${next.listName || next.name}` : 'Fin de la lista';
  $('#go-button').querySelector('span').textContent = isCart ? 'LANZAR' : 'GO';
  $('#go-button').querySelector('small').textContent = isCart ? 'Ejecutar selección' : 'Ejecutar cue';
}

function renderRunning() {
  $('#active-count').textContent = state.running.length;
  $('#running-summary').textContent = state.running.length ? `${state.running.length} activo${state.running.length === 1 ? '' : 's'}` : 'Ninguno';
  $('#running-mini-list').innerHTML = state.running.length ? state.running.map((cue) => `<div class="running-chip"><strong>${escapeHtml(cue.number || '—')} · ${escapeHtml(cue.listName || cue.name || 'Sin nombre')}</strong><span>${escapeHtml(cue.type || 'Cue')}</span></div>`).join('') : '<div class="empty-state">No hay cues ejecutándose</div>';
  $('#active-grid').innerHTML = state.running.length ? state.running.map((cue) => `<article class="active-card"><header><span>● EN EJECUCIÓN</span><span>${escapeHtml(cue.type || '')}</span></header><div><h3>${escapeHtml(cue.number || '—')} · ${escapeHtml(cue.listName || cue.name || 'Sin nombre')}</h3><p>${escapeHtml(cue.name || '')}</p></div><footer><button data-active-action="togglePauseCue" data-cue-id="${attr(cue.uniqueID)}">Pausa / seguir</button><button data-active-action="stopCue" data-cue-id="${attr(cue.uniqueID)}">Detener</button></footer></article>`).join('') : '<div class="empty-state">No hay cues activos en este momento.</div>';
  $$('[data-active-action]').forEach((button) => button.addEventListener('click', () => act(button.dataset.activeAction, button.dataset.cueId)));
}

function renderWorkspacePicker() {
  const select = $('[name="workspaceId"]');
  if (!select) return;
  const selected = state.config.workspaceId || '';
  select.innerHTML = '<option value="">Primero disponible</option>' + state.workspaces.map((workspace) => `<option value="${attr(workspace.uniqueID)}">${escapeHtml(workspace.displayName)}</option>`).join('');
  select.value = selected;
}

function connected() {
  return ['connected', 'demo'].includes(state.status.state);
}

function activateKind(kind) {
  const list = currentList(kind);
  if (!list) return;
  state.activeKind = kind;
  if (kind === 'list' && state.currentListId !== list.uniqueID) {
    state.currentListId = list.uniqueID;
    state.playheadId = null;
    act('setCurrentCueList', list.uniqueID);
  }
  render();
}

function selectCue(id, kind = state.activeKind, scroll = false) {
  state.focusedIds[kind] = id;
  activateKind(kind);
  renderCueList();
  renderStandby();
  if (scroll) document.querySelector(`[data-cue-id="${CSS.escape(id)}"][data-cue-kind="${kind}"]`)?.scrollIntoView({ block: 'nearest' });
}

function moveFocus(delta) {
  const kind = state.activeKind;
  const cues = visibleCues(kind);
  if (!cues.length) return;
  const current = cues.findIndex((cue) => cue.uniqueID === (state.focusedIds[kind] || (kind === 'list' ? state.playheadId : null)));
  const next = Math.max(0, Math.min(cues.length - 1, (current < 0 ? 0 : current) + delta));
  selectCue(cues[next].uniqueID, kind, true);
  vibrate(20);
}

function toggleActivePanel() {
  const target = state.activeKind === 'list' ? 'cart' : 'list';
  if (currentList(target)) activateKind(target);
  else toast(target === 'cart' ? 'No hay Cue Carts' : 'No hay Cue Lists');
}

function focusPlayhead() {
  if (!state.playheadId) return toast('No hay cue en el playhead');
  state.focusedIds.list = state.playheadId;
  activateKind('list');
  requestAnimationFrame(() => document.querySelector('.cue-row.playhead')?.scrollIntoView({ block: 'nearest' }));
  vibrate(22);
}

async function act(action, explicitCueId, extraPayload = {}) {
  if (!connected()) {
    toast('No hay conexión con QLab', 'error');
    openSettings();
    return;
  }
  if (state.showLocked && action === 'resetAll') {
    toast('Desbloquea el modo Show para hacer Reset', 'error');
    vibrate([40, 35, 40]);
    return;
  }
  const isCart = currentList()?.type === 'Cart';
  if (isCart && action === 'previous') { moveFocus(-1); return; }
  if (isCart && action === 'next') { moveFocus(1); return; }
  if (isCart && action === 'go') action = 'startCue';
  const cueId = explicitCueId || focusedCue()?.uniqueID || state.playheadId;
  if (action === 'setPlayhead' && currentList()?.uniqueID) {
    await window.qdeck.action('setCurrentCueList', { cueId: currentList().uniqueID });
  }
  await window.qdeck.action(action, { ...extraPayload, cueId });
}

function adjustVolume(scope, delta) {
  if (!connected()) return act(delta > 0 ? 'activeVolumeUp' : 'activeVolumeDown', null, { amount: Math.abs(delta) });
  const cue = focusedCue();
  if (scope === 'cue' && !cue) {
    toast('Selecciona un cue para ajustar su volumen', 'error');
    vibrate([35, 25, 35]);
    return;
  }
  const action = `${scope === 'cue' ? 'cue' : 'active'}Volume${delta > 0 ? 'Up' : 'Down'}`;
  act(action, scope === 'cue' ? cue.uniqueID : null, { amount: Math.abs(delta) });
  toast(`${scope === 'cue' ? 'Cue enfocado' : 'Cues activos'}: ${delta > 0 ? '+' : ''}${delta} dB`);
}

function switchView(view) {
  state.view = view;
  $$('.view').forEach((element) => element.classList.toggle('active', element.id === `view-${view}`));
  $$('.tab').forEach((element) => element.classList.toggle('active', element.dataset.view === view));
}

function cycleView(delta) {
  const views = ['show', 'active', 'controls'];
  const index = views.indexOf(state.view);
  switchView(views[(index + delta + views.length) % views.length]);
}

function openSettings() {
  if (state.showLocked) {
    toast('Modo Show bloqueado: desbloquéalo para abrir configuración');
    return;
  }
  fillSettings();
  $('#settings-dialog').showModal();
}

function fillSettings() {
  const form = $('#settings-form');
  for (const key of ['host', 'port', 'passcode', 'workspaceId']) if (form.elements[key]) form.elements[key].value = state.config[key] ?? '';
  form.elements.autoConnect.checked = state.config.autoConnect !== false;
  form.elements.demoMode.checked = Boolean(state.config.demoMode);
  renderWorkspacePicker();
}

function formConfig() {
  const form = $('#settings-form');
  return {
    host: form.elements.host.value.trim(), port: Number(form.elements.port.value || 53000), passcode: form.elements.passcode.value.trim(),
    workspaceId: form.elements.workspaceId.value, autoConnect: form.elements.autoConnect.checked, demoMode: form.elements.demoMode.checked
  };
}

function toast(message, type = '') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  $('#toast-region').append(element);
  setTimeout(() => element.remove(), 3200);
}

function flash(element) {
  element.animate([{ filter: 'brightness(1.6)' }, { filter: 'brightness(1)' }], { duration: 280 });
}

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
  const gamepad = navigator.getGamepads?.()[gamepadState.index];
  gamepad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: 90, strongMagnitude: .5, weakMagnitude: .25 }).catch(() => {});
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function attr(value) { return escapeHtml(value); }

// Gamepad / Steam Input -------------------------------------------------------
const gamepadState = { index: -1, previous: [], axesReady: true, panelAxisReady: true, repeatAt: 0, panicStart: 0, panicSent: false, viewCombo: false, triggerReady: [true, true] };

window.addEventListener('gamepadconnected', (event) => {
  gamepadState.index = event.gamepad.index;
  gamepadState.previous = event.gamepad.buttons.map((button) => button.pressed);
  $('#gamepad-status').classList.add('online');
  $('#gamepad-status').lastChild.textContent = ' Deck conectada';
  toast(`Mando detectado: ${event.gamepad.id.includes('Steam') ? 'Steam Deck' : event.gamepad.id}`);
});

window.addEventListener('gamepaddisconnected', () => {
  gamepadState.index = -1;
  $('#gamepad-status').classList.remove('online');
  $('#gamepad-status').lastChild.textContent = ' Sin mando';
});

function pollGamepad(now) {
  const gamepad = navigator.getGamepads?.()[gamepadState.index];
  if (gamepad) {
    const pressed = gamepad.buttons.map((button) => button.pressed);
    const down = (index) => pressed[index] && !gamepadState.previous[index];
    const up = (index) => !pressed[index] && gamepadState.previous[index];
    const modifier = pressed[8]; // View / Select
    if (down(8)) gamepadState.viewCombo = false;

    if (down(0)) { modifier ? act('resumeAll') : act('go'); gamepadState.viewCombo ||= modifier; }
    if (down(1)) { modifier ? act('stopAll') : act('stopCue'); gamepadState.viewCombo ||= modifier; }
    if (down(2)) { modifier ? act('pauseAll') : act('togglePauseCue'); gamepadState.viewCombo ||= modifier; }
    if (down(3)) { act('previewCue'); gamepadState.viewCombo ||= modifier; }
    if (down(4)) { modifier ? act('previousSequence') : cycleCollection('list', -1); gamepadState.viewCombo ||= modifier; }
    if (down(5)) { modifier ? act('nextSequence') : cycleCollection('list', 1); gamepadState.viewCombo ||= modifier; }
    if (down(9)) openSettings();
    if (down(12)) { modifier ? adjustVolume('active', 1) : act('previous'); gamepadState.viewCombo ||= modifier; }
    if (down(13)) { modifier ? adjustVolume('active', -1) : act('next'); gamepadState.viewCombo ||= modifier; }
    if (down(14)) cycleView(-1);
    if (down(15)) cycleView(1);

    // Gatillos: los Cue Carts se mantienen en un carril separado de las listas.
    const leftTrigger = gamepad.buttons[6]?.value > .82;
    const rightTrigger = gamepad.buttons[7]?.value > .82;
    if (leftTrigger && gamepadState.triggerReady[0]) { cycleCollection('cart', -1); gamepadState.triggerReady[0] = false; }
    if (!leftTrigger) gamepadState.triggerReady[0] = true;
    if (rightTrigger && gamepadState.triggerReady[1]) { cycleCollection('cart', 1); gamepadState.triggerReady[1] = false; }
    if (!rightTrigger) gamepadState.triggerReady[1] = true;

    // Stick izquierdo: navegar; stick derecho horizontal: vistas, vertical: panel.
    const ly = gamepad.axes[1] || 0;
    const rx = gamepad.axes[2] || 0;
    const ry = gamepad.axes[3] || 0;
    if (Math.abs(ly) > .65 && now > gamepadState.repeatAt) { moveFocus(ly > 0 ? 1 : -1); gamepadState.repeatAt = now + 170; }
    if (Math.abs(rx) > .78 && gamepadState.axesReady) { cycleView(rx > 0 ? 1 : -1); gamepadState.axesReady = false; }
    if (Math.abs(rx) < .35) gamepadState.axesReady = true;
    if (Math.abs(ry) > .78 && gamepadState.panelAxisReady) {
      const kind = ry > 0 ? 'cart' : 'list';
      if (currentList(kind)) activateKind(kind);
      gamepadState.panelAxisReady = false;
    }
    if (Math.abs(ry) < .35) gamepadState.panelAxisReady = true;

    // L3 + R3 durante 1.2 segundos: PANIC; nunca se dispara con un toque.
    if (pressed[10] && pressed[11]) {
      if (!gamepadState.panicStart) gamepadState.panicStart = now;
      const progress = Math.min(1, (now - gamepadState.panicStart) / 1200);
      setHoldProgress(progress);
      if (progress >= 1 && !gamepadState.panicSent) { act('panic'); gamepadState.panicSent = true; toast('PANIC enviado a QLab', 'error'); }
    } else {
      if (down(10)) gamepadState.l3Single = true;
      if (up(10) && gamepadState.l3Single && !gamepadState.panicStart) act('setPlayhead');
      if (down(11)) gamepadState.r3Single = true;
      if (up(11) && gamepadState.r3Single && !gamepadState.panicStart) switchView('active');
      gamepadState.panicStart = 0; gamepadState.panicSent = false; gamepadState.l3Single = false; gamepadState.r3Single = false; setHoldProgress(0);
    }
    if (up(8) && !gamepadState.viewCombo) switchView(state.view === 'controls' ? 'show' : 'controls');
    gamepadState.previous = pressed;
  }
  requestAnimationFrame(pollGamepad);
}

function setHoldProgress(progress) {
  $$('.hold-progress').forEach((element) => { element.style.width = `${progress * 100}%`; });
}

function bindHoldButton(element, action) {
  let timer;
  const begin = () => {
    element.classList.add('holding');
    timer = setTimeout(() => { act(action); toast(`${action === 'panic' ? 'PANIC' : 'Reset'} enviado`, 'error'); element.classList.remove('holding'); }, 1200);
  };
  const cancel = () => { clearTimeout(timer); element.classList.remove('holding'); };
  element.addEventListener('pointerdown', begin);
  element.addEventListener('pointerup', cancel);
  element.addEventListener('pointerleave', cancel);
  element.addEventListener('pointercancel', cancel);
}

// Keyboard mappings are also targets for Steam Input rear paddles.
window.addEventListener('keydown', (event) => {
  if (event.repeat || ['INPUT', 'SELECT'].includes(event.target.tagName)) return;
  const map = { ' ': 'go', ArrowUp: 'previous', ArrowDown: 'next', x: 'togglePauseCue', b: 'stopCue', y: 'previewCue', f: 'setPlayhead' };
  if (event.key === 'Escape') $('#settings-dialog').open && $('#settings-dialog').close();
  else if (event.key === 'Tab') { event.preventDefault(); cycleView(event.shiftKey ? -1 : 1); }
  else if (event.key === ',') openSettings();
  else if (event.key === 'q') { event.preventDefault(); event.shiftKey ? act('previousSequence') : cycleCollection('list', -1); }
  else if (event.key === 'e') { event.preventDefault(); event.shiftKey ? act('nextSequence') : cycleCollection('list', 1); }
  else if (event.key === '[') { event.preventDefault(); act('previous'); }
  else if (event.key === ']') { event.preventDefault(); act('next'); }
  else if (event.key === '\\') { event.preventDefault(); toggleActivePanel(); }
  else if (event.key.toLowerCase() === 'p') { event.preventDefault(); focusPlayhead(); }
  else if (map[event.key]) { event.preventDefault(); act(map[event.key]); }
});

// Steam Input puede exponer un trackpad como rueda aunque el puntero no esté
// sobre la lista. En ese caso desplazamos el panel que el operador tiene activo.
window.addEventListener('wheel', (event) => {
  if (state.view !== 'show' || event.target.closest('.cue-list, dialog')) return;
  const panel = $(`#cue-list-${state.activeKind === 'cart' ? 'carts' : 'lists'}`);
  panel?.scrollBy({ top: event.deltaY, behavior: 'auto' });
}, { passive: true });

function bindUi() {
  $$('.tab').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-action]').filter((button) => button.dataset.action !== 'resetAll').forEach((button) => button.addEventListener('click', () => act(button.dataset.action)));
  $('#brand').addEventListener('click', () => switchView('show'));
  $('#settings-button').addEventListener('click', openSettings);
  $('#connection-button').addEventListener('click', openSettings);
  $('#lock-button').addEventListener('click', () => {
    state.showLocked = !state.showLocked;
    localStorage.setItem('qdeck-show-locked', state.showLocked ? '1' : '0');
    renderLock();
    toast(state.showLocked ? 'Modo Show bloqueado' : 'Modo Show desbloqueado');
    vibrate(state.showLocked ? [25, 35, 25] : 25);
  });
  $('#close-settings').addEventListener('click', () => $('#settings-dialog').close());
  $('#list-picker-list').addEventListener('click', () => cycleCollection('list', 1));
  $('#list-picker-cart').addEventListener('click', () => cycleCollection('cart', 1));
  $$('[data-cycle-kind]').forEach((button) => button.addEventListener('click', () => cycleCollection(button.dataset.cycleKind, Number(button.dataset.cycle))));
  $$('[data-volume-delta]').forEach((button) => button.addEventListener('click', () => adjustVolume(button.dataset.volumeScope, Number(button.dataset.volumeDelta))));
  $('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    state.config = await window.qdeck.saveConfig(formConfig());
    $('#settings-dialog').close();
    toast(state.config.demoMode ? 'Modo demostración iniciado' : 'Conectando con QLab…');
  });
  $('#disconnect-button').addEventListener('click', async () => { await window.qdeck.disconnect(); $('#settings-dialog').close(); });
  bindHoldButton($('#panic-button'), 'panic');
  bindHoldButton($('#panic-card'), 'panic');
  const reset = $('[data-action="resetAll"]');
  reset.removeAttribute('data-action');
  bindHoldButton(reset, 'resetAll');
}

function bindBackend() {
  window.qdeck.on('config', (config) => { state.config = config; fillSettings(); });
  window.qdeck.on('status', (status) => {
    state.status = status;
    renderConnection();
    if (['error', 'denied'].includes(status.state)) toast(status.detail, 'error');
    if (status.state === 'denied' && !$('#settings-dialog').open) {
      setTimeout(openSettings, 150);
    }
  });
  window.qdeck.on('workspaces', (workspaces) => { state.workspaces = workspaces; renderWorkspacePicker(); });
  window.qdeck.on('cueLists', (lists) => {
    state.lists = Array.isArray(lists) ? lists : [];
    for (const kind of ['list', 'cart']) {
      if (!state.selectedCollectionIds[kind]) state.selectedCollectionIds[kind] = collections(kind)[0]?.uniqueID || null;
    }
    if (!state.currentListId) state.currentListId = currentList(state.activeKind)?.uniqueID || null;
    render();
  });
  window.qdeck.on('currentCueList', (id) => {
    if (id && id !== 'none') {
      const list = state.lists.find((item) => item.uniqueID === id);
      if (list) {
        const kind = collectionKind(list);
        state.selectedCollectionIds[kind] = id;
        // Solo las Cue Lists poseen playhead. Los carts permanecen en su panel
        // sin desplazar el contexto de operación del panel superior.
        if (kind === 'list') state.currentListId = id;
      }
    }
    render();
  });
  window.qdeck.on('playhead', (id) => {
    state.playheadId = id === 'none' ? null : id;
    if (!state.focusedIds.list) state.focusedIds.list = state.playheadId;
    state.lastMessageAt = Date.now();
    render();
    requestAnimationFrame(() => document.querySelector('.cue-row.playhead')?.scrollIntoView({ block: 'nearest' }));
  });
  window.qdeck.on('running', (running) => { state.running = Array.isArray(running) ? running : []; state.lastMessageAt = Date.now(); renderRunning(); renderCueList(); });
  window.qdeck.on('event', () => { state.lastMessageAt = Date.now(); });
  window.qdeck.on('action', ({ action }) => {
    if (action === 'refresh') return;
    const indicator = $('#command-status');
    indicator.textContent = 'ENVIANDO';
    indicator.className = 'command-status pending';
  });
  window.qdeck.on('commandAck', ({ action, status, latency }) => {
    const indicator = $('#command-status');
    const ok = status === 'ok';
    indicator.textContent = ok ? `OK ${latency} ms` : 'SIN CONFIRMAR';
    indicator.className = `command-status ${ok ? 'ok' : 'error'}`;
    if (!ok) {
      vibrate([55, 35, 55]);
      toast(`QLab no confirmó ${action}`, 'error');
    } else if (action === 'go' || action === 'startCue') {
      vibrate([38, 22, 62]);
      flash($('#go-button'));
    } else if (action === 'panic') vibrate(240);
    else if (action === 'setCurrentCueList' || action === 'setPlayhead') vibrate(18);
    else vibrate(30);
    clearTimeout(window.__qdeckAckTimer);
    window.__qdeckAckTimer = setTimeout(() => {
      indicator.textContent = 'LISTO';
      indicator.className = 'command-status';
    }, 1600);
  });
  window.qdeck.on('log', (log) => { if (log.level === 'error') toast(log.text, 'error'); });
}

bindUi();
bindBackend();
window.qdeck.getConfig().then((config) => { state.config = config; fillSettings(); if (!config.host && !config.demoMode) setTimeout(openSettings, 250); });
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('es-GT', { hour12: false }); }, 500);
requestAnimationFrame(pollGamepad);
render();
