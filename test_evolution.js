const axios = require('axios');

const baseUrl = 'https://evolution.guerrizeeg.com.br';
const instance = 'lumiz';
const apiKey = '4C7B62D0F0CD-4D1A-82E0-31F68E056A60';
const messageId = '3B9E0C9A21A5C1309A0C';
const remoteJid = '556592556938@s.whatsapp.net';

async function testGetBase64() {
    // 1. Find the message first
    const findUrl = `${baseUrl}/chat/findMessages/${instance}`;
    const findPayload = {
        where: {
            key: {
                id: messageId,
                remoteJid: remoteJid
            }
        }
    };

    try {
        console.log(`Finding message...`);
        const findResponse = await axios.post(findUrl, findPayload, {
            headers: { 'apikey': apiKey, 'Content-Type': 'application/json' }
        });

        const messages = findResponse.data.messages.records;
        if (!messages || messages.length === 0) {
            console.log('❌ Message not found');
            return;
        }

        const fullMessage = messages[0];
        console.log('✅ Message found');

        // 2. Call getBase64FromMediaMessage with the full message
        const base64Url = `${baseUrl}/chat/getBase64FromMediaMessage/${instance}`;
        const base64Payload = {
            message: fullMessage,
            convertToMp4: false
        };

        console.log(`Testing: ${base64Url}`);
        const base64Response = await axios.post(base64Url, base64Payload, {
            headers: { 'apikey': apiKey, 'Content-Type': 'application/json' }
        });

        console.log(`✅ Success: Status: ${base64Response.status}`);
        // Response should contain base64
        if (base64Response.data && base64Response.data.base64) {
            console.log(`Base64 length: ${base64Response.data.base64.length}`);
        } else {
            console.log('Response data:', JSON.stringify(base64Response.data).substring(0, 200));
        }

    } catch (error) {
        if (error.response) {
            console.log(`❌ Failed: Status: ${error.response.status}`);
            try {
                console.log(`   Error: ${JSON.stringify(error.response.data)}`);
            } catch (e) {
                console.log(`   Error data: ${error.response.data}`);
            }
        } else {
            console.log(`❌ Failed: Error: ${error.message}`);
        }
    }
}

testGetBase64();
