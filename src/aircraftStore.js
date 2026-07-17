'use strict';

const EventEmitter = require('events');

const DEFAULT_STALE_AFTER_MS = 20000;
const DEFAULT_SWEEP_INTERVAL_MS = 5000;

// Holds the latest known state of every aircraft reported by JoinFS.
//
// JoinFS's websocket feed can push a partial aircraft list per message (not
// necessarily every aircraft every time), so incoming data is merged/upserted
// into the existing map rather than replacing it wholesale - replacing
// wholesale would wrongly evict any aircraft simply omitted from a given
// message. Aircraft that stop being reported are considered gone once they
// haven't been updated for `staleAfterMs` and are swept out on a timer,
// which is what drives #DP (delete pilot) packets.
class AircraftStore extends EventEmitter {
  constructor({ staleAfterMs = DEFAULT_STALE_AFTER_MS, sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS } = {}) {
    super();
    this.aircraft = new Map(); // callsign -> { data, lastSeen }
    this.staleAfterMs = staleAfterMs;
    this.sweepTimer = setInterval(() => this._sweep(), sweepIntervalMs);
    this.sweepTimer.unref();
  }

  getAll() {
    return Array.from(this.aircraft.values(), (entry) => entry.data);
  }

  get(callsign) {
    const entry = this.aircraft.get(callsign);
    return entry && entry.data;
  }

  upsert(aircraftList) {
    const now = Date.now();
    const added = [];
    const updated = [];

    for (const ac of aircraftList) {
      if (!ac || !ac.callsign) {
        continue;
      }
      const existing = this.aircraft.get(ac.callsign);
      this.aircraft.set(ac.callsign, { data: ac, lastSeen: now });
      if (existing) {
        updated.push(ac);
      } else {
        added.push(ac);
      }
    }

    if (added.length || updated.length) {
      this.emit('diff', { added, updated, removed: [] });
    }
  }

  _sweep() {
    const now = Date.now();
    const removed = [];
    for (const [callsign, entry] of this.aircraft) {
      if (now - entry.lastSeen > this.staleAfterMs) {
        this.aircraft.delete(callsign);
        removed.push(callsign);
      }
    }
    if (removed.length) {
      this.emit('diff', { added: [], updated: [], removed });
    }
  }

  stop() {
    clearInterval(this.sweepTimer);
  }
}

module.exports = { AircraftStore };
