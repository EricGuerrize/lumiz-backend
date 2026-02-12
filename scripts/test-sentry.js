require('dotenv').config();
require('../src/instrument.js');
const Sentry = require("@sentry/node");

async function testSentry() {
    console.log('Testing Sentry connection...');
    try {
        throw new Error("Sentry Test Error from Lumiz Backend: " + new Date().toISOString());
    } catch (e) {
        console.log('Capturing exception...');
        const result = Sentry.captureException(e);
        console.log('Exception captured. ID:', result);
        await Sentry.flush(2000);
        console.log('Sentry flushed.');
    }
}

testSentry();
