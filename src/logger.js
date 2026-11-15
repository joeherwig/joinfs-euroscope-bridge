'use strict';

const fs = require('fs');
const path = require('path');

function createLogger(baseDir, { stationLogging = false } = {}) {
  const logFile = path.join(baseDir, 'joinfs-euroscope-bridge.log');
  let stream;
  try {
    stream = fs.createWriteStream(logFile, { flags: 'a' });
  } catch (err) {
    stream = null;
  }

  function write(level, message) {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    console.log(line);
    if (stream) {
      stream.write(line + '\n');
    }
  }

  return {
    info: (message) => write('INFO', message),
    warn: (message) => write('WARN', message),
    error: (message) => write('ERROR', message),
    // Discovery logging (raw FSD lines, station/ATIS state, TSAPI payloads).
    // Off by default; when on it goes into the same single log file.
    station: (message) => {
      if (stationLogging) {
        write('STATION', message);
      }
    },
  };
}

module.exports = { createLogger };
