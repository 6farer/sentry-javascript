import {
  GLOBAL_OBJ,
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
  applySdkMetadata,
  getRootSpan,
  registerSpanErrorInstrumentation,
  spanToJSON,
  stripUrlQueryAndFragment,
  vercelWaitUntil,
} from '@sentry/core';
import type { VercelEdgeOptions } from '@sentry/vercel-edge';
import { getDefaultIntegrations, init as vercelEdgeInit } from '@sentry/vercel-edge';
import { isBuild } from '../common/utils/isBuild';
import { flushSafelyWithTimeout } from '../common/utils/responseEnd';
import { distDirRewriteFramesIntegration } from './distDirRewriteFramesIntegration';

export * from '@sentry/vercel-edge';
export * from '../common';
export { captureUnderscoreErrorException } from '../common/pages-router-instrumentation/_error';
export { wrapApiHandlerWithSentry } from './wrapApiHandlerWithSentry';

export type EdgeOptions = VercelEdgeOptions;

const globalWithInjectedValues = GLOBAL_OBJ as typeof GLOBAL_OBJ & {
  _sentryRewriteFramesDistDir?: string;
};

/** Inits the Sentry NextJS SDK on the Edge Runtime. */
export function init(options: VercelEdgeOptions = {}): void {
  registerSpanErrorInstrumentation();

  if (isBuild()) {
    return;
  }

  const customDefaultIntegrations = getDefaultIntegrations(options);

  // This value is injected at build time, based on the output directory specified in the build config. Though a default
  // is set there, we set it here as well, just in case something has gone wrong with the injection.
  const distDirName = process.env._sentryRewriteFramesDistDir || globalWithInjectedValues._sentryRewriteFramesDistDir;

  if (distDirName) {
    customDefaultIntegrations.push(distDirRewriteFramesIntegration({ distDirName }));
  }

  const opts = {
    ...options,
  };

  applySdkMetadata(opts, 'nextjs');

  const client = vercelEdgeInit(opts);

  client?.on('spanStart', span => {
    const spanAttributes = spanToJSON(span).data;

    // Mark all spans generated by Next.js as 'auto'
    if (spanAttributes?.['next.span_type'] !== undefined) {
      span.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN, 'auto');
    }

    // Make sure middleware spans get the right op
    if (spanAttributes?.['next.span_type'] === 'Middleware.execute') {
      span.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, 'http.server.middleware');
      span.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_SOURCE, 'url');
    }
  });

  // Use the preprocessEvent hook instead of an event processor, so that the users event processors receive the most
  // up-to-date value, but also so that the logic that detects changes to the transaction names to set the source to
  // "custom", doesn't trigger.
  client?.on('preprocessEvent', event => {
    // The otel auto inference will clobber the transaction name because the span has an http.target
    if (
      event.type === 'transaction' &&
      event.contexts?.trace?.data?.['next.span_type'] === 'Middleware.execute' &&
      event.contexts?.trace?.data?.['next.span_name']
    ) {
      if (event.transaction) {
        event.transaction = stripUrlQueryAndFragment(event.contexts.trace.data['next.span_name']);
      }
    }
  });

  client?.on('spanEnd', span => {
    if (span === getRootSpan(span)) {
      vercelWaitUntil(flushSafelyWithTimeout());
    }
  });
}

/**
 * Just a passthrough in case this is imported from the client.
 */
export function withSentryConfig<T>(exportedUserNextConfig: T): T {
  return exportedUserNextConfig;
}
