'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  joinfsWebSocketUrl: '',
  joinfsAuthHeaderName: '',
  joinfsAuthHeaderValue: '',
  fsdListenHost: '127.0.0.1',
  fsdListenPort: 6809,
  updateIntervalMs: 1000,
};

function isRunningAsPackagedExe() {
  // Prefer the official API where available (Node 21.7+ / 20.12+).
  try {
    const sea = require('node:sea');
    if (typeof sea.isSea === 'function') {
      return sea.isSea();
    }
  } catch (err) {
    // node:sea not available on this Node version - fall through to the
    // heuristic below, which works on any version that supports SEA at all.
  }
  // In a packaged SEA binary, argv[0] and argv[1] both point at the
  // executable itself (there's no separate interpreter + script path like
  // there is with `node src/index.js`). Confirmed empirically against a
  // built SEA binary on this machine's Node 20.5.0.
  return process.argv[1] === process.execPath;
}

function resolveBaseDir() {
  if (isRunningAsPackagedExe()) {
    return path.dirname(process.execPath);
  }
  return path.resolve(__dirname, '..');
}

function loadConfig() {
  const baseDir = resolveBaseDir();
  const configPath = path.join(baseDir, 'config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `config.json not found at ${configPath}. Copy config.example.json to config.json next to the executable and fill in your JoinFS WebSocket details.`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse ${configPath}: ${err.message}`);
  }

  const config = { ...DEFAULTS, ...parsed, baseDir, configPath };

  if (!config.joinfsWebSocketUrl) {
    throw new Error(`"joinfsWebSocketUrl" is not set in ${configPath}.`);
  }

  return config;
}

module.exports = { loadConfig, resolveBaseDir };
