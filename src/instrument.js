// Import with `import * as Sentry from "@sentry/node"` if you are using ESM
const Sentry = require("@sentry/node");

// Ensure Sentry is initialized if DSN is provided
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        // Setting this option to true will send default PII data to Sentry.
        // For example, automatic IP address collection on events
        sendDefaultPii: true,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 1.0,
    });
    console.log('[SENTRY] Sentry initialized via instrument.js');
} else {
    console.log('[SENTRY] SENTRY_DSN not found, skipping initialization');
}
