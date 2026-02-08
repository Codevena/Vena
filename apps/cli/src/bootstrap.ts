#!/usr/bin/env node

import { EventEmitter } from 'node:events';

// Raise the default listener limit before any other modules execute.
if (EventEmitter.defaultMaxListeners !== 0 && EventEmitter.defaultMaxListeners < 30) {
  EventEmitter.defaultMaxListeners = 30;
}
const previousMaxListeners = process.getMaxListeners();
if (previousMaxListeners !== 0 && previousMaxListeners < 30) {
  process.setMaxListeners(30);
}

await import('./index.js');
