'use strict';

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { AircraftStore } = require('./aircraftStore');
const { JoinFsClient } = require('./joinfsClient');
const { FsdServer } = require('./fsdServer');
const { TsapiClient } = require('./tsapiClient');
const { StationTracker } = require('./stationTracker');
const { configureConsoleWindow } = require('./windowControl');

const CONSOLE_TITLE = 'JoinFS-EuroScope Bridge';

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // No logger yet (we don't know baseDir) - print directly and exit.
    console.error(`Startup failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger(config.baseDir, { stationLogging: config.stationLogging === true });
  logger.info('joinfs-euroscope-bridge starting...');
  logger.info(`Using config: ${config.configPath}`);

  const aircraftStore = new AircraftStore();

  const joinfsClient = new JoinFsClient({
    url: config.joinfsWebSocketUrl,
    authHeaderName: config.joinfsAuthHeaderName,
    authHeaderValue: config.joinfsAuthHeaderValue,
    aircraftStore,
    logger,
  });

  // Station tracking is only active when something consumes it: the TSAPI
  // webhook (tsapiUrl set) or the discovery log (stationLogging).
  let tsapiClient = null;
  if (config.tsapiUrl) {
    tsapiClient = new TsapiClient({
      url: config.tsapiUrl,
      authHeaderName: config.tsapiAuthHeaderName,
      authHeaderValue: config.tsapiAuthHeaderValue,
      timeoutMs: config.tsapiTimeoutMs,
      logger,
    });
    logger.info(`TSAPI webhook enabled: ${config.tsapiUrl}`);
  }
  const stationTracker = tsapiClient || config.stationLogging === true
    ? new StationTracker({ logger, tsapiClient })
    : null;

  const fsdServer = new FsdServer({
    host: config.fsdListenHost,
    port: config.fsdListenPort,
    aircraftStore,
    logger,
    stationTracker,
  });

  fsdServer.start();
  joinfsClient.start();

  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info('Shutting down...');
    joinfsClient.stop();
    fsdServer.stop();
    aircraftStore.stop();
    // Best-effort "offline" webhooks, but never hang the shutdown.
    const done = stationTracker ? stationTracker.shutdown() : Promise.resolve();
    Promise.race([done, new Promise((resolve) => setTimeout(resolve, 2000))])
      .finally(() => process.exit(0));
  }

  process.on('SIGINT', shutdown);
  // Windows maps the console window's close button (X) to SIGHUP - closing
  // the log window is meant to shut the bridge down completely, not just
  // hide it (minimizing is handled separately via windowControl).
  process.on('SIGHUP', shutdown);

  logger.info('Minimizing to taskbar - close this window to stop the bridge.');
  configureConsoleWindow(CONSOLE_TITLE, logger);
}

main();
