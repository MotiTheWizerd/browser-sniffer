import { state } from './state.js';
import { flushBuffer } from './storage.js';

const FLUSH_COUNT = 250;
const FLUSH_INTERVAL_MS = 2000;
const BUFFER_LIMIT = 5000;

function scheduleFlush() {
  if (state.buffer.length >= FLUSH_COUNT || Date.now() - state.lastFlush > FLUSH_INTERVAL_MS) {
    flushBuffer();
  }
  if (state.buffer.length > BUFFER_LIMIT) {
    state.dropBodies = true;
    console.warn('Buffer high—storing headers only for next events');
  } else {
    state.dropBodies = false;
  }
}

export function addEvent(evt) {
  state.buffer.push(evt);
  scheduleFlush();
}

export { FLUSH_COUNT, FLUSH_INTERVAL_MS, BUFFER_LIMIT, scheduleFlush };
