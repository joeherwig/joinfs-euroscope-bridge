'use strict';

const WebSocket = require('ws');

const RECONNECT_DELAY_MS = 5000;

class JoinFsClient {
  constructor({ url, authHeaderName, authHeaderValue, aircraftStore, logger }) {
    this.url = url;
    this.authHeaderName = authHeaderName;
    this.authHeaderValue = authHeaderValue;
    this.aircraftStore = aircraftStore;
    this.logger = logger;
    this.ws = null;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    if (this.ws) {
      this.ws.close();
    }
  }

  _connect() {
    if (this.stopped) {
      return;
    }

    const headers = {};
    if (this.authHeaderName && this.authHeaderValue) {
      headers[this.authHeaderName] = this.authHeaderValue;
    }

    this.logger.info(`Connecting to JoinFS at ${this.url} ...`);
    this.ws = new WebSocket(this.url, { headers });

    this.ws.on('open', () => {
      this.logger.info('Connected to JoinFS.');
    });

    this.ws.on('message', (data) => this._handleMessage(data));

    this.ws.on('error', (err) => {
      this.logger.error(`JoinFS connection error: ${err.message}`);
    });

    this.ws.on('close', () => {
      if (this.stopped) {
        return;
      }
      this.logger.warn(`JoinFS connection closed. Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
      setTimeout(() => this._connect(), RECONNECT_DELAY_MS);
    });
  }

  _handleMessage(data) {
    let message;
    try {
      message = JSON.parse(data.toString('utf8'));
    } catch (err) {
      this.logger.warn(`Received non-JSON message from JoinFS, ignoring: ${err.message}`);
      return;
    }

    if (message.type !== 'aircraft_update' || !Array.isArray(message.aircraft)) {
      return;
    }

    this.aircraftStore.upsert(message.aircraft);
  }
}

module.exports = { JoinFsClient };
