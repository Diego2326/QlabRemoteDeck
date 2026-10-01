'use strict';

const END = 0xc0;
const ESC = 0xdb;
const ESC_END = 0xdc;
const ESC_ESC = 0xdd;

function pad4(length) {
  return (4 - (length % 4)) % 4;
}

function oscString(value) {
  const text = Buffer.from(String(value), 'utf8');
  return Buffer.concat([text, Buffer.alloc(1 + pad4(text.length + 1))]);
}

function encodeMessage(address, args = []) {
  if (!address.startsWith('/')) throw new Error('OSC addresses must begin with /');
  const tags = [','];
  const chunks = [oscString(address)];

  for (const arg of args) {
    if (typeof arg === 'string') {
      tags.push('s');
      chunks.push(oscString(arg));
    } else if (typeof arg === 'number' && Number.isInteger(arg)) {
      tags.push('i');
      const value = Buffer.alloc(4);
      value.writeInt32BE(arg);
      chunks.push(value);
    } else if (typeof arg === 'number') {
      tags.push('f');
      const value = Buffer.alloc(4);
      value.writeFloatBE(arg);
      chunks.push(value);
    } else if (typeof arg === 'boolean') {
      tags.push(arg ? 'T' : 'F');
    } else if (arg === null) {
      tags.push('N');
    } else {
      throw new Error(`Tipo OSC no soportado: ${typeof arg}`);
    }
  }

  chunks.splice(1, 0, oscString(tags.join('')));
  return Buffer.concat(chunks);
}

function readString(buffer, offset) {
  const end = buffer.indexOf(0, offset);
  if (end < 0) throw new Error('Cadena OSC incompleta');
  const value = buffer.toString('utf8', offset, end);
  const used = end - offset + 1;
  return { value, offset: end + 1 + pad4(used) };
}

function decodeMessage(buffer) {
  let cursor = readString(buffer, 0);
  const address = cursor.value;
  cursor = readString(buffer, cursor.offset);
  if (!cursor.value.startsWith(',')) throw new Error('Faltan etiquetas OSC');
  const args = [];
  let offset = cursor.offset;

  for (const tag of cursor.value.slice(1)) {
    if (tag === 's') {
      const result = readString(buffer, offset);
      args.push(result.value);
      offset = result.offset;
    } else if (tag === 'i') {
      args.push(buffer.readInt32BE(offset));
      offset += 4;
    } else if (tag === 'f') {
      args.push(buffer.readFloatBE(offset));
      offset += 4;
    } else if (tag === 'd') {
      args.push(buffer.readDoubleBE(offset));
      offset += 8;
    } else if (tag === 'h') {
      args.push(Number(buffer.readBigInt64BE(offset)));
      offset += 8;
    } else if (tag === 'T') args.push(true);
    else if (tag === 'F') args.push(false);
    else if (tag === 'N' || tag === 'I') args.push(null);
    else if (tag === 'b') {
      const size = buffer.readInt32BE(offset);
      offset += 4;
      args.push(buffer.subarray(offset, offset + size));
      offset += size + pad4(size);
    } else {
      throw new Error(`Etiqueta OSC no soportada: ${tag}`);
    }
  }
  return { address, args };
}

function decodePacket(buffer) {
  if (buffer.subarray(0, 8).toString('ascii') !== '#bundle\0') return [decodeMessage(buffer)];
  const messages = [];
  let offset = 16;
  while (offset + 4 <= buffer.length) {
    const size = buffer.readInt32BE(offset);
    offset += 4;
    messages.push(...decodePacket(buffer.subarray(offset, offset + size)));
    offset += size;
  }
  return messages;
}

function slipEncode(buffer) {
  const bytes = [END];
  for (const byte of buffer) {
    if (byte === END) bytes.push(ESC, ESC_END);
    else if (byte === ESC) bytes.push(ESC, ESC_ESC);
    else bytes.push(byte);
  }
  bytes.push(END);
  return Buffer.from(bytes);
}

class SlipDecoder {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.frame = [];
    this.escaped = false;
  }

  push(chunk) {
    for (const byte of chunk) {
      if (byte === END) {
        if (this.frame.length) this.onFrame(Buffer.from(this.frame));
        this.frame = [];
        this.escaped = false;
      } else if (this.escaped) {
        if (byte === ESC_END) this.frame.push(END);
        else if (byte === ESC_ESC) this.frame.push(ESC);
        else this.frame.push(byte);
        this.escaped = false;
      } else if (byte === ESC) {
        this.escaped = true;
      } else {
        this.frame.push(byte);
      }
    }
  }
}

module.exports = { encodeMessage, decodeMessage, decodePacket, slipEncode, SlipDecoder };
