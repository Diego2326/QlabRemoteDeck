'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { QLabClient } = require('../src/main/qlab-client');

test('acepta la respuesta de permisos de QLab 5.6', () => {
  const client = new QLabClient();
  let authorized = false;
  client.onAuthorized = () => { authorized = true; };
  client.onReply({
    address: '/reply/workspace/TEST/connect',
    args: [JSON.stringify({
      address: '/workspace/TEST/connect',
      status: 'ok',
      data: 'ok:view|edit|control'
    })]
  });
  assert.equal(authorized, true);
});

test('rechaza badpass de QLab', () => {
  const client = new QLabClient();
  let status;
  client.on('status', (next) => { status = next; });
  client.onReply({
    address: '/reply/workspace/TEST/connect',
    args: [JSON.stringify({ address: '/workspace/TEST/connect', status: 'ok', data: 'badpass' })]
  });
  assert.equal(status.state, 'denied');
  assert.equal(status.detail, 'Código de acceso incorrecto');
});

test('convierte en playhead vacío el error esperado de un Cue Cart', () => {
  const client = new QLabClient();
  let playhead = 'sin-evento';
  client.on('playhead', (id) => { playhead = id; });
  client.onReply({
    address: '/reply/workspace/TEST/cue_id/CART/playheadID',
    args: [JSON.stringify({ address: '/workspace/TEST/cue_id/CART/playheadID', status: 'error' })]
  });
  assert.equal(playhead, null);
});

test('emite confirmación para un comando registrado', () => {
  const client = new QLabClient();
  client.pendingActions.set('/workspace/TEST/go', [{ action: 'go', sentAt: Date.now() - 12 }]);
  let confirmation;
  client.on('commandAck', (ack) => { confirmation = ack; });
  client.onReply({
    address: '/reply/workspace/TEST/go',
    args: [JSON.stringify({ address: '/workspace/TEST/go', status: 'ok' })]
  });
  assert.equal(confirmation.action, 'go');
  assert.equal(confirmation.status, 'ok');
  assert.ok(confirmation.latency >= 0);
});

test('asocia la respuesta normalizada de un setter con su comando', () => {
  const client = new QLabClient();
  client.pendingActions.set('/workspace/TEST/currentCueListID/LIST', [{ action: 'setCurrentCueList', sentAt: Date.now() }]);
  let confirmation;
  client.on('commandAck', (ack) => { confirmation = ack; });
  client.onReply({
    address: '/reply/workspace/TEST/currentCueListID',
    args: [JSON.stringify({ address: '/workspace/TEST/currentCueListID', status: 'ok', data: 'LIST' })]
  });
  assert.equal(confirmation.action, 'setCurrentCueList');
  assert.equal(client.pendingActions.size, 0);
});

test('construye ajustes de volumen relativos sin alterar el balance', () => {
  const client = new QLabClient();
  client.workspace = { uniqueID: 'TEST' };
  const sent = [];
  client.sendAction = (action, address, ...args) => { sent.push({ action, address, args }); return true; };
  client.action('activeVolumeDown', { amount: 3 });
  client.action('cueVolumeUp', { cueId: 'CUE', amount: 1 });
  assert.deepEqual(sent, [
    { action: 'activeVolumeDown', address: '/workspace/TEST/cue/active/level/0/0/-/live', args: [3] },
    { action: 'cueVolumeUp', address: '/workspace/TEST/cue_id/CUE/level/0/0/+/live', args: [1] }
  ]);
});

test('no consulta playhead de un Cue Cart', () => {
  const client = new QLabClient();
  client.workspace = { uniqueID: 'TEST' };
  client.cueLists = [{ uniqueID: 'CART', type: 'Cart' }];
  const sent = [];
  client.send = (address) => { sent.push(address); return true; };
  client.onReply({
    address: '/reply/workspace/TEST/currentCueListID',
    args: [JSON.stringify({ address: '/workspace/TEST/currentCueListID', status: 'ok', data: 'CART' })]
  });
  assert.deepEqual(sent, []);
});

test('un error confirmado no produce dos avisos', () => {
  const client = new QLabClient();
  client.pendingActions.set('/workspace/TEST/go', [{ action: 'go', sentAt: Date.now() }]);
  let confirmation;
  let logs = 0;
  client.on('commandAck', (ack) => { confirmation = ack; });
  client.on('log', () => { logs += 1; });
  client.onReply({
    address: '/reply/workspace/TEST/go',
    args: [JSON.stringify({ address: '/workspace/TEST/go', status: 'error' })]
  });
  assert.equal(confirmation.status, 'error');
  assert.equal(logs, 0);
});
