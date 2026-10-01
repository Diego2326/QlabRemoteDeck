'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeMessage, decodeMessage, decodePacket, slipEncode, SlipDecoder } = require('../src/main/osc');

test('codifica y decodifica los tipos OSC usados por QLab', () => {
  const packet = encodeMessage('/workspace/DEMO/test', ['hola', 42, 1.5, true, false, null]);
  const message = decodeMessage(packet);
  assert.equal(message.address, '/workspace/DEMO/test');
  assert.deepEqual(message.args.slice(0, 2), ['hola', 42]);
  assert.ok(Math.abs(message.args[2] - 1.5) < 0.0001);
  assert.deepEqual(message.args.slice(3), [true, false, null]);
});

test('SLIP conserva bytes END y ESC y tolera chunks', () => {
  const original = Buffer.from([1, 0xc0, 2, 0xdb, 3]);
  const encoded = slipEncode(original);
  const frames = [];
  const decoder = new SlipDecoder((frame) => frames.push(frame));
  decoder.push(encoded.subarray(0, 3));
  decoder.push(encoded.subarray(3));
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], original);
});

test('decodifica bundles OSC', () => {
  const one = encodeMessage('/uno', [1]);
  const two = encodeMessage('/dos', ['ok']);
  const size = (buffer) => { const prefix = Buffer.alloc(4); prefix.writeInt32BE(buffer.length); return Buffer.concat([prefix, buffer]); };
  const bundle = Buffer.concat([Buffer.from('#bundle\0'), Buffer.alloc(8), size(one), size(two)]);
  assert.deepEqual(decodePacket(bundle).map((message) => message.address), ['/uno', '/dos']);
});
