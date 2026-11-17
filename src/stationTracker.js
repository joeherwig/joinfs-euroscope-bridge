'use strict';

const { decodeMetarInText } = require('./metarDecoder');

const REASSERT_INTERVAL_MS = 5 * 60 * 1000;
const ATIS_DEBOUNCE_MS = 500;

// Merges the FSD text lines of an ATIS into one string. EuroScope renders the
// pause markers "[ ]" of its ATIS template as runs of spaces (3 inside a line,
// 2 at a line end), so a run of 2+ whitespace characters - also across a line
// break - is a pause and is written as " .. ". A single space is just a word gap.
function mergeAtisLines(lines) {
  let text = '';
  for (const line of lines) {
    if (text && !/\s$/.test(text) && !/^\s/.test(line)) {
      text += ' ';
    }
    text += line;
  }
  const paused = text.replace(/\s{2,}/g, ' .. ').trim();
  return decodeMetarInText(paused)
    .replace(/(\.\.)(\s+\.\.)+/g, '$1') // pause next to an already literal ".."
    .replace(/^[\s.]*?(?=[^\s.])/, '') // no leading pause
    .trim();
}

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
        const payload = this._payload(name, false);
        this.stations.delete(name);
        this.atis.delete(name);
        this._send(payload);
      }
    }
  }

  async shutdown() {
    clearInterval(this.reassertTimer);
    for (const name of [...this.stations.keys()]) {
      const payload = this._payload(name, false);
      this.stations.delete(name);
      this._send(payload);
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

  // A station is just a COM1 tuned to a frequency, so it is reported in the
  // same shape as a pilot's COM update (tsapi: { comsupdate: [ {...} ] }).
  // Must be called before the station is removed (offline keeps its com1 so
  // tsapi can find the channel).
  _payload(callsign, online = true) {
    const st = this.stations.get(callsign);
    const entry = {
      callsign,
      nickname: st.conn.nickname || callsign,
      com1: st.frequencies[0],
    };
    const a = this.atis.get(callsign);
    if (online && a && a.lines.length) {
      // EuroScope may deliver the ATIS as several FSD text lines; they are
      // merged into one text (later the channel description).
      entry.text = mergeAtisLines(a.lines);
    }
    entry.online = online;
    return { comsupdate: [entry] };
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

module.exports = { StationTracker, mergeAtisLines };
