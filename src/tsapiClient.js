'use strict';

// Calls the TeamSpeak API (tsapi) `PUT /station` webhook. Only constructed
// when "tsapiUrl" is set in config.json.
class TsapiClient {
  constructor({ url, authHeaderName, authHeaderValue, timeoutMs, logger }) {
    this.url = url;
    this.authHeaderName = authHeaderName;
    this.authHeaderValue = authHeaderValue;
    this.timeoutMs = timeoutMs || 5000;
    this.logger = logger;
  }

  async putStation(payload) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.authHeaderName && this.authHeaderValue) {
      headers[this.authHeaderName] = this.authHeaderValue;
    }
    try {
      const res = await fetch(this.url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await res.text().catch(() => '');
      if (res.ok) {
        this.logger.station(`TSAPI ${res.status} for ${payload.station}: ${text.slice(0, 300)}`);
      } else {
        this.logger.warn(`TSAPI ${this.url} returned ${res.status} for ${payload.station}: ${text.slice(0, 300)}`);
      }
    } catch (err) {
      this.logger.warn(`TSAPI ${this.url} failed for ${payload.station}: ${err.message}`);
    }
  }
}

module.exports = { TsapiClient };
