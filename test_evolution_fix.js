const evolutionService = require('./src/services/evolutionService');

const messageKey = {
    remoteJid: '556592556938@s.whatsapp.net',
    id: '3B9E0C9A21A5C1309A0C',
    fromMe: false
};

async function testFix() {
    try {
        console.log('Testing downloadMedia with fallback...');
        const result = await evolutionService.downloadMedia(messageKey);

        console.log('✅ Success!');
        console.log('Status:', result.status);
        console.log('Content-Type:', result.contentType);
        console.log('Data length:', result.data.length);
    } catch (error) {
        console.error('❌ Failed:', error.message);
    }
}

testFix();
