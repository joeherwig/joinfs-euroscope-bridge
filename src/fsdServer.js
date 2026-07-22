'use strict';

const net = require('net');
const protocol = require('./fsdProtocol');

const HEARTBEAT_INTERVAL_MS = 30000;

class Connection {
  constructor(socket, logger) {
    this.socket = socket;
    this.logger = logger;
    this.buffer = '';
    this.atcCallsign = null;
    this.loggedIn = false;
  }

  send(data) {
    if (this.socket.writable) {
      this.socket.write(data);
    }
  }
}

class FsdServer {
  constructor({ host, port, aircraftStore, logger }) {
    this.host = host;
    this.port = port;
    this.aircraftStore = aircraftStore;
    this.logger = logger;
    this.server = null;
    this.connections = new Set();
    this.heartbeatTimer = null;

    this._onDiff = this._onDiff.bind(this);
  }

  start() {
    this.server = net.createServer((socket) => this._handleConnection(socket));
    this.server.on('error', (err) => this.logger.error(`FSD server error: ${err.message}`));
    this.server.listen(this.port, this.host, () => {
      this.logger.info(`Listening for EuroScope on ${this.host}:${this.port}`);
    });

    this.aircraftStore.on('diff', this._onDiff);

    this.heartbeatTimer = setInterval(() => {
      const packet = protocol.buildHeartbeat();
      for (const conn of this.connections) {
        if (conn.loggedIn) {
          conn.send(packet);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.aircraftStore.off('diff', this._onDiff);
    for (const conn of this.connections) {
      conn.socket.destroy();
    }
    if (this.server) {
      this.server.close();
    }
  }

  _handleConnection(socket) {
    const conn = new Connection(socket, this.logger);
    this.connections.add(conn);
    this.logger.info(`EuroScope connected from ${socket.remoteAddress}:${socket.remotePort}`);

    // Deliberately no server-identification ($DI) banner here: that banner
    // self-identifies as "VATSIM FSD", and EuroScope rejects the connection
    // if that doesn't match the connection mode selected in its Connect
    // dialog ("VATSIM server found while non-VATSIM server was requested").
    // Non-VATSIM-flavored servers (e.g. IVAO) skip this banner entirely and
    // let the client initiate - which is also consistent with not
    // implementing the VATSIM-only $ZC/$ZR challenge-auth handshake.

    socket.on('data', (chunk) => this._handleData(conn, chunk));

    socket.on('error', (err) => {
      this.logger.warn(`Connection error: ${err.message}`);
    });

    socket.on('close', () => {
      this.connections.delete(conn);
      this.logger.info(`EuroScope disconnected (${conn.atcCallsign || 'not logged in'}).`);
    });
  }

  _handleData(conn, chunk) {
    conn.buffer += chunk.toString('utf8');
    const lines = conn.buffer.split('\n');
    conn.buffer = lines.pop();

    for (const rawLine of lines) {
      const parsed = protocol.parseLine(rawLine);
      if (parsed) {
        this._handlePacket(conn, parsed);
      }
    }
  }

  _handlePacket(conn, packet) {
    switch (packet.type) {
      case 'ID':
        // Client identification - no validation needed, this is a private server.
        break;

      case 'AA':
        this._handleAtcLogin(conn, packet.callsign);
        break;

      case 'DA':
        // Client is logging off cleanly; the socket 'close' event handles cleanup.
        break;

      case 'CQ':
        this._handleClientQuery(conn, packet);
        break;

      case 'TM':
        // Text message directed at one of our synthetic aircraft - nothing to
        // reply with (no real pilot), just log so it's visible it arrived.
        this.logger.info(`Text message received: ${packet.fields.slice(1).join(':')}`);
        break;

      default:
        break;
    }
  }

  _handleAtcLogin(conn, callsign) {
    conn.atcCallsign = callsign;
    conn.loggedIn = true;
    this.logger.info(`EuroScope logged in as ${callsign}.`);

    conn.send(protocol.buildMotd(callsign));
    conn.send(protocol.buildPostLoginCapsExchange(callsign, conn.socket.remoteAddress));

    for (const aircraft of this.aircraftStore.getAll()) {
      this._sendAircraft(conn, aircraft);
    }
  }

  _handleClientQuery(conn, packet) {
    // $CQ(requester):(requestee):(command)[:...]
    const command = packet.fields[2];
    const targetCallsign = packet.fields[3];

    if (command === 'FP' && targetCallsign) {
      const aircraft = this.aircraftStore.get(targetCallsign);
      if (aircraft) {
        conn.send(protocol.buildFlightPlan(aircraft));
      } else {
        this.logger.warn(`Flight plan requested for unknown callsign: ${targetCallsign}`);
      }
    }
    // Other queries (CAPS, RN, ATIS, ...) are not required for basic
    // display/interaction and are intentionally left unanswered.
  }

  _sendAircraft(conn, aircraft) {
    conn.send(protocol.buildAddPilot(aircraft.callsign));
    conn.send(protocol.buildFlightPlan(aircraft));
    conn.send(protocol.buildPosition(aircraft));
  }

  _onDiff({ added, updated, removed }) {
    for (const conn of this.connections) {
      if (!conn.loggedIn) {
        continue;
      }
      for (const aircraft of added) {
        this._sendAircraft(conn, aircraft);
      }
      for (const aircraft of updated) {
        conn.send(protocol.buildPosition(aircraft));
      }
      for (const callsign of removed) {
        conn.send(protocol.buildDeletePilot(callsign));
      }
    }
  }
}

module.exports = { FsdServer };
