import * as Sentry from '@sentry/browser';

window.Sentry = Sentry;

window.Replay = Sentry.replayIntegration({
  flushMinDelay: 200,
  flushMaxDelay: 200,
  minReplayDuration: 0,
  useCompression: false,
  blockAllMedia: false,
  unmask: ['.sentry-unmask, [data-sentry-unmask]'],
});

Sentry.init({
  dsn: 'https://public@dsn.ingest.sentry.io/1337',
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 0.0,
  integrations: [window.Replay],
  sendDefaultPii: true,
});
