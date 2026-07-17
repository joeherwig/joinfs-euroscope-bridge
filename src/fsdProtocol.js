'use strict';

const CRLF = '\r\n';

function sanitizeField(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value).replace(/[:\r\n]/g, ' ').trim() || fallback;
}

// Deterministic pseudo-CID derived from the callsign, so the same aircraft
// gets a stable identifier across updates without tracking extra state.
function pseudoCidFor(callsign) {
  let hash = 0;
  for (let i = 0; i < callsign.length; i += 1) {
    hash = (hash * 31 + callsign.charCodeAt(i)) >>> 0;
  }
  return 100000 + (hash % 899999);
}

// Post-login capability exchange (VATSIM flavor, per fsd-doc connect.md).
// The server sends all four of these lines unprompted right after ATC login
// - EuroScope's login handshake appears to wait on this full sequence
// (particularly the IP line) before considering the connection established.
function buildPostLoginCapsExchange(atcCallsign, clientIp) {
  const lines = [
    `$CQSERVER:${atcCallsign}:CAPS`,
    `$CRSERVER:${atcCallsign}:ATC:N:${atcCallsign}`,
    `$CRSERVER:${atcCallsign}:CAPS:ATCINFO=1:SECPOS=1`,
    `$CRSERVER:${atcCallsign}:IP:${clientIp}`,
  ];
  return lines.map((line) => line + CRLF).join('');
}

function buildMotd(atcCallsign) {
  const lines = [
    'This server bridges live JoinFS traffic into EuroScope.',
    'Aircraft shown here are simulated network entities - there are no pilots to reply to messages.',
  ];
  return lines.map((line) => `#TMserver:${atcCallsign}:${line}${CRLF}`).join('');
}

function buildAddPilot(callsign) {
  const cid = pseudoCidFor(callsign);
  // #AP(callsign):SERVER:(cid):(password):(rating):(protocol version):(num2):(full name ICAO)
  return `#AP${callsign}:SERVER:${cid}::1:9:1:JoinFS Pilot${CRLF}`;
}

function buildDeletePilot(callsign) {
  const cid = pseudoCidFor(callsign);
  return `#DP${callsign}:${cid}${CRLF}`;
}

function rulesCode(rules) {
  const normalized = sanitizeField(rules, 'IFR').toUpperCase();
  return normalized.startsWith('V') ? 'V' : 'I';
}

// $FP(callsign):*A:(rules):(equipment):(TAS):(origin):(dep time):(actual dep time):
//   (altitude):(dest):(EET hrs):(EET min):(fuel hrs):(fuel min):(alternate):(remarks):(route)
// 17 fields total - route is deliberately the trailing field (see plan notes).
function buildFlightPlan(aircraft) {
  const callsign = sanitizeField(aircraft.callsign);
  const equipment = sanitizeField(aircraft.icaoType, 'ZZZZ');
  const tas = sanitizeField(Math.round(aircraft.speed || 0));
  const origin = sanitizeField(aircraft.from, 'ZZZZ');
  const dest = sanitizeField(aircraft.to, 'ZZZZ');
  const altitude = sanitizeField(Math.round(aircraft.altitude || 0));
  const remarks = sanitizeField(aircraft.remarks, '');
  const route = sanitizeField(aircraft.route, '');

  const fields = [
    `$FP${callsign}`,
    '*A',
    rulesCode(aircraft.rules),
    equipment,
    tas,
    origin,
    '0000',
    '0000',
    altitude,
    dest,
    '0',
    '0',
    '0',
    '0',
    '',
    remarks,
    route,
  ];

  return fields.join(':') + CRLF;
}

// Packs pitch/bank/heading into a single uint32, matching the encoding used
// by real FSD servers/clients (confirmed against openfsd's pitchBankHeading):
// 10 bits each for pitch (22-31), bank (12-21), heading (2-11), scaled by 359/1023.
function packHeading(headingDeg) {
  const normalized = ((Number(headingDeg) || 0) % 360 + 360) % 360;
  const ticks = Math.round((normalized * 1023) / 359) & 0x3ff;
  return ticks << 2;
}

// @(mode):(callsign):(squawk):(rating):(lat):(lon):(alt):(groundspeed):(PBH):(flags)
function buildPosition(aircraft) {
  const callsign = sanitizeField(aircraft.callsign);
  const squawk = sanitizeField(aircraft.squawk, '1200');
  const lat = Number(aircraft.latitude || 0).toFixed(6);
  const lon = Number(aircraft.longitude || 0).toFixed(6);
  const alt = Math.round(aircraft.altitude || 0);
  const groundspeed = Math.round(aircraft.speed || 0);
  const pbh = packHeading(aircraft.heading);

  const fields = ['@N', callsign, squawk, '1', lat, lon, alt, groundspeed, pbh, 0];
  return fields.join(':') + CRLF;
}

function buildHeartbeat() {
  return `#DLSERVER:*:0:0${CRLF}`;
}

// Minimal parser for inbound lines from EuroScope. Returns { type, fields }
// where fields is the raw colon-split array (fields[0] includes the prefix).
function parseLine(line) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) {
    return null;
  }
  const fields = trimmed.split(':');
  const head = fields[0];

  if (head.startsWith('$ID')) {
    return { type: 'ID', fields };
  }
  if (head.startsWith('#AA')) {
    return { type: 'AA', fields, callsign: head.slice(3) };
  }
  if (head.startsWith('#DA')) {
    return { type: 'DA', fields, callsign: head.slice(3) };
  }
  if (head.startsWith('$CQ')) {
    return { type: 'CQ', fields };
  }
  if (head.startsWith('$CR')) {
    return { type: 'CR', fields };
  }
  if (head.startsWith('#TM')) {
    return { type: 'TM', fields };
  }
  if (head.startsWith('%')) {
    return { type: 'ATC_POSITION', fields };
  }
  return { type: 'UNKNOWN', fields };
}

module.exports = {
  buildPostLoginCapsExchange,
  buildMotd,
  buildAddPilot,
  buildDeletePilot,
  buildFlightPlan,
  buildPosition,
  buildHeartbeat,
  packHeading,
  parseLine,
  pseudoCidFor,
};
