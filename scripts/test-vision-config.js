require('dotenv').config();
const googleVisionService = require('../src/services/googleVisionService');

console.log('Testing Google Vision Configuration...');

// Give it a moment to initialize if there's any async logic (though init is synchronous in the file I saw)
setTimeout(() => {
    if (googleVisionService.client) {
        console.log('SUCCESS: Client initialized (Service Account or ADC).');
    } else if (googleVisionService.apiKey) {
        console.log('SUCCESS: API Key configured (REST fallback).');
    } else {
        console.error('FAILURE: No credentials configured.');
        process.exit(1);
    }
    console.log('Configuration check passed.');
}, 100);
