'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { QLabClient } = require('../src/main/qlab-client');

const configFile = path.join(os.homedir(), 'Library', 'Application Support', 'qlab-remote-deck', 'config.json');
let saved = {};
try { saved = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { /* defaults */ }

const client = new QLabClient({ ...saved, host: process.argv[2] || saved.host || '127.0.0.1', demoMode: false });
const result = { discovered: [], status: null, cueLists: null, playhead: null, running: null, replies: [] };
let finishing = false;

function finish(code = 0) {
  if (finishing) return;
  finishing = true;
  client.disconnect(true);
  console.log(JSON.stringify(result, null, 2));
  setTimeout(() => process.exit(code), 20);
}

client.on('workspaces', (workspaces) => {
  result.discovered = workspaces.map(({ uniqueID, displayName, port, version }) => ({ uniqueID, displayName, port, version }));
});
client.on('status', (status) => {
  if (finishing) return;
  result.status = { state: status.state, detail: status.detail, workspace: status.workspace?.displayName };
  if (status.state === 'denied' || status.state === 'error') finish(2);
});
client.on('cueLists', (lists) => {
  result.cueLists = lists.map((list) => ({ number: list.number, name: list.listName || list.name, type: list.type, cues: list.cues?.length || 0 }));
  setTimeout(() => finish(0), 500);
});
client.on('playhead', (id) => { result.playhead = id; });
client.on('running', (cues) => { result.running = cues.map((cue) => ({ number: cue.number, name: cue.listName || cue.name, type: cue.type })); });
client.on('message', (message) => {
  if (!message.address.startsWith('/reply/')) return;
  result.replies.push({ address: message.address, payload: message.args[0] });
});

setTimeout(() => {
  if (!result.cueLists) {
    result.timeout = 'QLab no devolvió las listas dentro de 8 segundos';
    finish(3);
  }
}, 8000);

client.connect();
