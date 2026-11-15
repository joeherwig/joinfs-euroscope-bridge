'use strict';

const REASSERT_INTERVAL_MS = 5 * 60 * 1000;
const ATIS_DEBOUNCE_MS = 500;

// Turns EuroScope's ATC positions / ATIS packets into TSAPI `PUT /station`
// payloads. Every connection EuroScope opens is its own station - including
// the ATIS connection (e.g. EDDS_ATIS, with its own frequency and the ATIS
// text from the "ATIS connection setup" dialog). Payloads are always logged
// (station logging); they are only sent when a TsapiClient is configured.
class StationTracker {
  constructor({ logger, tsapiClient }) {
    this.logger = logger;
    this.tsapiClient = tsapiClient || null;
    this.stations = new Map(); // callsign -> { conn, frequencies, facilityType }
    this.atis = new Map(); // station callsign -> { lines, pending, complete, timer }
    this.inflight = new Set();
    this.reassertTimer = null;
    if (this.tsapiClient) {
      this.reassertTimer = setInterval(() => this._reassert(), REASSERT_INTERVAL_MS);
      this.reassertTimer.unref();
    }
  }

  static isAtisCallsign(callsign) {
    return /_ATIS$/i.test(callsign);
  }

  // Returns true when the station is new (caller may then request its ATIS).
  onPosition(conn, pos) {
    if (pos.facilityType === 0 || pos.frequencies.length === 0) {
      return false;
    }
    const prev = this.stations.get(pos.callsign);
    const changed = !prev
      || prev.frequencies.join('&') !== pos.frequencies.join('&')
      || prev.facilityType !== pos.facilityType;
    this.stations.set(pos.callsign, { conn, frequencies: pos.frequencies, facilityType: pos.facilityType });
    if (changed) {
      this.logger.station(
        `Station ${pos.callsign}: ${pos.facilityName}, frequencies ${pos.frequencies.join(', ')}, vis ${pos.visRange} nm`
      );
      this._send(this._payload(pos.callsign));
    }
    return !prev;
  }

  // Called right before the bridge asks the ATIS connection for its text, so
  // the reply starts a fresh text instead of appending to the previous one.
  beginAtisRefresh(callsign) {
    const a = this._atisFor(callsign);
    a.complete = true;
  }

  onAtis(info) {
    const a = this._atisFor(info.callsign);
    switch (info.kind) {
      case 'T':
        if (a.complete) {
          a.pending = [];
          a.complete = false;
        }
        a.pending.push(info.value);
        break;
      case 'E':
        a.complete = true;
        break;
      default:
        return; // letter (A), logoff time (Z), voice server (V): not channel-relevant
    }
    clearTimeout(a.timer);
    a.timer = setTimeout(() => {
      if (JSON.stringify(a.pending) === JSON.stringify(a.lines)) {
        return;
      }
      a.lines = a.pending.slice();
      this.logger.station(`ATIS text ${info.callsign}: ${JSON.stringify(a.lines)}`);
      if (this.stations.has(info.callsign)) {
        this._send(this._payload(info.callsign));
      }
    }, ATIS_DEBOUNCE_MS);
    a.timer.unref();
  }

  // callsign omitted = every station owned by that connection (socket closed)
  onLogoff(conn, callsign) {
    for (const [name, st] of [...this.stations]) {
      if (st.conn === conn && (!callsign || name === callsign)) {
        this.stations.delete(name);
        this.atis.delete(name);
        this._send({ station: name, online: false });
      }
    }
  }

  async shutdown() {
    clearInterval(this.reassertTimer);
    for (const name of [...this.stations.keys()]) {
      this.stations.delete(name);
      this._send({ station: name, online: false });
    }
    await Promise.allSettled([...this.inflight]);
  }

  _atisFor(callsign) {
    let a = this.atis.get(callsign);
    if (!a) {
      a = { lines: [], pending: [], complete: true, timer: null };
      this.atis.set(callsign, a);
    }
    return a;
  }

  _payload(callsign) {
    const st = this.stations.get(callsign);
    const payload = { station: callsign, frequency: st.frequencies[0], online: true };
    const a = this.atis.get(callsign);
    if (a && a.lines.length) {
      // EuroScope may deliver the ATIS as several FSD text lines; the channel
      // description gets them merged into one text.
      payload.atis_text = a.lines.join(' ').replace(/\s+/g, ' ').trim();
    }
    return payload;
  }

  _reassert() {
    for (const callsign of this.stations.keys()) {
      this._send(this._payload(callsign));
    }
  }

  _send(payload) {
    this.logger.station(`TSAPI payload: ${JSON.stringify(payload)}`);
    if (this.tsapiClient) {
      const p = this.tsapiClient.putStation(payload);
      this.inflight.add(p);
      p.finally(() => this.inflight.delete(p));
    }
  }
}

module.exports = { StationTracker };
