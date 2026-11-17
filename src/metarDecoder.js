'use strict';

// Rewrites METAR groups that appear inside an ATIS text into plain words,
// e.g. "23004KT 180V280 9999 FEW041 BKN018 09/07 Q1007 NOSIG" ->
// "WIND 230 DEGREES 4 KNOTS .. WIND VARIABLE FROM 180 TO 280 DEGREES ..
//  VISIBILITY MORE THAN 10 KILOMETERS .. CLOUDS FEW AT 4100 FEET .. ...".
// Text that is not a METAR group is left untouched. Output is upper case and
// uses " .. " as pause marker, like the rest of the ATIS text.
//
// Ambiguous tokens (4-digit visibility, weather codes such as RA/UP/SA, AUTO,
// ...) are only decoded inside a METAR "run", which starts at a wind group or a
// ddhhmmZ time group and ends at the first token that is not a METAR group.

const WIND = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/;
const WIND_VARIABLE = /^(\d{3})V(\d{3})$/;
const TIME = /^\d{2}(\d{2})(\d{2})Z$/;
const CLOUD = /^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/;
const VERTICAL_VIS = /^VV(\d{3})$/;
const TEMPERATURE = /^(M?\d{2})\/(M?\d{2})$/;
const QNH = /^Q(\d{4})$/;
const ALTIMETER = /^A(\d{2})(\d{2})$/;
const VISIBILITY = /^(\d{4})(?:[NSEW]{1,2})?$/;
const VISIBILITY_SM = /^(?:(\d+)\/(\d+)|(\d+))SM$/;
const RVR = /^R(\d{2}[LCR]?)\/([PM]?)(\d{4})(?:V[PM]?\d{4})?[UDN]?$/;
const WEATHER = /^([-+]|VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)$/;
const WEATHER_DESCRIPTOR_ONLY = /^(?:VC)?(?:TS|SH|FZ|BL|DR)$/;

const CLOUD_AMOUNT = { FEW: 'FEW', SCT: 'SCATTERED', BKN: 'BROKEN', OVC: 'OVERCAST' };
const CLOUD_TYPE = { CB: 'CUMULONIMBUS', TCU: 'TOWERING CUMULUS' };
const PHENOMENON = {
  DZ: 'DRIZZLE', RA: 'RAIN', SN: 'SNOW', SG: 'SNOW GRAINS', PL: 'ICE PELLETS', GR: 'HAIL', GS: 'SMALL HAIL',
  UP: 'UNKNOWN PRECIPITATION', BR: 'MIST', FG: 'FOG', FU: 'SMOKE', VA: 'VOLCANIC ASH', DU: 'DUST', SA: 'SAND',
  HZ: 'HAZE', PY: 'SPRAY', PO: 'DUST WHIRLS', SQ: 'SQUALLS', FC: 'FUNNEL CLOUD', SS: 'SANDSTORM', DS: 'DUSTSTORM',
};
const DESCRIPTOR = {
  MI: 'SHALLOW', SH: 'SHOWERING', BC: 'PATCHES OF', PR: 'PARTIAL', DR: 'LOW DRIFTING', BL: 'BLOWING', TS: 'THUNDERSTORM', FZ: 'FREEZING',
};
const UNIT = { KT: ['KNOT', 'KNOTS'], MPS: ['METER PER SECOND', 'METERS PER SECOND'], KMH: ['KILOMETER PER HOUR', 'KILOMETERS PER HOUR'] };
const SIMPLE = {
  CAVOK: 'CAVOK',
  NOSIG: 'NO SIGNIFICANT CHANGE',
  BECMG: 'BECOMING',
  TEMPO: 'TEMPORARILY',
  NSW: 'NO SIGNIFICANT WEATHER',
};
// only meaningful inside a METAR run
const SIMPLE_IN_RUN = {
  AUTO: 'AUTOMATIC',
  COR: 'CORRECTED',
  NSC: 'NO SIGNIFICANT CLOUD',
  SKC: 'SKY CLEAR',
  NCD: 'NO CLOUD DETECTED',
};

function num(s) {
  return String(Number(s));
}

function signedTemp(s) {
  return s.startsWith('M') ? `MINUS ${num(s.slice(1))}` : num(s);
}

function plural(n, forms) {
  return Number(n) === 1 ? forms[0] : forms[1];
}

// Returns the decoded phrase for a token that is unambiguous anywhere, or null.
function decodeAlways(token) {
  let m;
  if ((m = WIND.exec(token))) {
    const unit = UNIT[m[4]];
    if (m[1] === '000' && Number(m[2]) === 0) {
      return 'WIND CALM';
    }
    const dir = m[1] === 'VRB' ? 'WIND VARIABLE' : `WIND ${m[1]} DEGREES`;
    let text = `${dir} ${num(m[2])} ${plural(m[2], unit)}`;
    if (m[3]) {
      text += ` GUSTING ${num(m[3])} ${plural(m[3], unit)}`;
    }
    return text;
  }
  if ((m = WIND_VARIABLE.exec(token))) {
    return `WIND VARIABLE FROM ${m[1]} TO ${m[2]} DEGREES`;
  }
  if ((m = TIME.exec(token))) {
    return `TIME ${m[1]}${m[2]} ZULU`;
  }
  if ((m = TEMPERATURE.exec(token))) {
    return `TEMPERATURE ${signedTemp(m[1])} .. DEWPOINT ${signedTemp(m[2])}`;
  }
  if ((m = QNH.exec(token))) {
    return `QNH ${m[1]} HECTOPASCAL`;
  }
  if ((m = VERTICAL_VIS.exec(token))) {
    return `VERTICAL VISIBILITY ${Number(m[1]) * 100} FEET`;
  }
  if (SIMPLE[token]) {
    return SIMPLE[token];
  }
  return null;
}

function cloudPhrase(m) {
  const type = m[3] ? ` ${CLOUD_TYPE[m[3]]}` : '';
  return `${CLOUD_AMOUNT[m[1]]} AT ${Number(m[2]) * 100} FEET${type}`;
}

function weatherPhrase(m) {
  const intensity = { '-': 'LIGHT', '+': 'HEAVY', VC: 'IN THE VICINITY' }[m[1]] || '';
  const descriptor = m[2] ? DESCRIPTOR[m[2]] : '';
  const what = m[3].match(/../g).map((c) => PHENOMENON[c]).join(' ');
  return [intensity, descriptor, what].filter(Boolean).join(' ');
}

// Returns { phrase, cloud } for tokens that are only METAR inside a run, or null.
function decodeInRun(token) {
  let m;
  if ((m = CLOUD.exec(token))) {
    return { phrase: cloudPhrase(m), cloud: true };
  }
  if ((m = ALTIMETER.exec(token))) {
    return { phrase: `ALTIMETER ${m[1]}.${m[2]} INCHES` };
  }
  if ((m = VISIBILITY_SM.exec(token))) {
    const miles = m[3] || `${m[1]}/${m[2]}`;
    return { phrase: `VISIBILITY ${miles} STATUTE MILES` };
  }
  if ((m = VISIBILITY.exec(token))) {
    const meters = Number(m[1]);
    if (meters >= 9999) {
      return { phrase: 'VISIBILITY MORE THAN 10 KILOMETERS' };
    }
    if (meters === 0) {
      return { phrase: 'VISIBILITY LESS THAN 50 METERS' };
    }
    return { phrase: `VISIBILITY ${meters} METERS` };
  }
  if ((m = RVR.exec(token))) {
    const bound = m[2] === 'P' ? 'MORE THAN ' : m[2] === 'M' ? 'LESS THAN ' : '';
    return { phrase: `RUNWAY VISUAL RANGE RUNWAY ${m[1]} ${bound}${Number(m[3])} METERS` };
  }
  if (SIMPLE_IN_RUN[token]) {
    return { phrase: SIMPLE_IN_RUN[token] };
  }
  if ((m = WEATHER.exec(token)) && !WEATHER_DESCRIPTOR_ONLY.test(token)) {
    return { phrase: weatherPhrase(m) };
  }
  return null;
}

function decodeMetarInText(text) {
  const tokens = text.split(' ');
  const out = [];
  let inRun = false;
  let lastWasCloud = false;

  for (const token of tokens) {
    if (token === '' || token === '..') {
      out.push(token);
      continue;
    }
    let phrase = decodeAlways(token);
    let cloud = false;
    if (phrase !== null) {
      if (WIND.test(token) || TIME.test(token)) {
        inRun = true;
      }
    } else if (inRun) {
      const r = decodeInRun(token);
      if (r) {
        phrase = r.phrase;
        cloud = Boolean(r.cloud);
      } else {
        inRun = false;
      }
    } else if (CLOUD.test(token)) {
      // FEW041 style tokens are unambiguous enough to decode outside a run too
      phrase = cloudPhrase(CLOUD.exec(token));
      cloud = true;
    }

    if (phrase === null) {
      out.push(token);
      lastWasCloud = false;
      continue;
    }
    if (cloud && !lastWasCloud) {
      phrase = `CLOUDS ${phrase}`;
    }
    lastWasCloud = cloud;
    out.push('..', phrase, '..');
  }

  return out
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/(\.\.)(\s+\.\.)+/g, '$1')
    .trim();
}

module.exports = { decodeMetarInText };
