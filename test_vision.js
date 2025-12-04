const evolutionService = require('./src/services/evolutionService');
const googleVisionService = require('./src/services/googleVisionService');

const messageKey = {
    remoteJid: '556592556938@s.whatsapp.net',
    id: '3B9E0C9A21A5C1309A0C',
    fromMe: false
};

async function testVision() {
    try {
        console.log('1. Downloading media...');
        const media = await evolutionService.downloadMedia(messageKey);
        console.log(`✅ Media downloaded. Size: ${media.data.length} bytes`);

        console.log('2. Sending to Google Vision...');
        const text = await googleVisionService.extractTextFromImage(media.data);

        console.log('✅ Vision Result:');
        console.log('-------------------');
        console.log(text);
        console.log('-------------------');
    } catch (error) {
        console.error('❌ Failed:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
    }
}

testVision();
