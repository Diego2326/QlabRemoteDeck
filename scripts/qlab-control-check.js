'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { QLabClient } = require('../src/main/qlab-client');

const configPath = path.join(os.homedir(), 'Library', 'Application Support', 'qlab-remote-deck', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const client = new QLabClient({ ...config, demoMode: false });
let currentId;
let listsReady = false;
let sent = false;
const replies = [];

function tryCheck() {
  if (sent || !currentId || !listsReady) return;
  sent = true;
  // Es idempotente: selecciona la lista que QLab ya reportó como activa.
  client.action('setCurrentCueList', { cueId: currentId });
}

client.on('currentCueList', (id) => { currentId = id; tryCheck(); });
client.on('cueLists', () => { listsReady = true; tryCheck(); });
client.on('commandAck', (ack) => {
  if (ack.action !== 'setCurrentCueList') return;
  console.log(JSON.stringify({ connected: true, safeCommand: 'setCurrentCueList (sin cambio)', confirmation: ack }, null, 2));
  client.disconnect(true);
  setTimeout(() => process.exit(ack.status === 'ok' ? 0 : 2), 20);
});
client.on('message', (message) => {
  if (message.address.startsWith('/reply/')) replies.push({ address: message.address, payload: message.args[0] });
});
client.on('status', (status) => {
  if (status.state === 'error' || status.state === 'denied') {
    console.error(JSON.stringify(status, null, 2));
    process.exit(2);
  }
});
setTimeout(() => {
  console.error(JSON.stringify({ error: 'QLab no confirmó el comando seguro dentro de 8 segundos.', replies: replies.slice(-8) }, null, 2));
  client.disconnect(true);
  process.exit(3);
}, 8000);

client.connect();
