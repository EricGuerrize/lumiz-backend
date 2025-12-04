const fs = require('fs');
const path = require('path');
const googleVisionService = require('../src/services/googleVisionService');

// Caminho da imagem enviada pelo usuário
const imagePath = '/Users/ericguerrize/.gemini/antigravity/brain/b0b27261-bcd1-4079-8396-451c7dba1dde/uploaded_image_1764771129765.png';

async function testVisionLocal() {
    try {
        console.log('1. Reading local image...');
        if (!fs.existsSync(imagePath)) {
            throw new Error(`Image not found at ${imagePath}`);
        }
        const imageBuffer = fs.readFileSync(imagePath);
        console.log(`✅ Image read. Size: ${imageBuffer.length} bytes`);

        console.log('2. Sending to Google Vision...');
        // Detect mime type simply by extension for this test
        const mimeType = 'image/png';

        const result = await googleVisionService.processImage(imageBuffer, mimeType);

        console.log('✅ Vision Result:');
        console.log('-------------------');
        console.log(JSON.stringify(result, null, 2));
        console.log('-------------------');

        if (result.tipo_documento === 'erro') {
            console.error('❌ Vision returned an error type');
            process.exit(1);
        }

        console.log('✅ Test Passed!');
    } catch (error) {
        console.error('❌ Failed:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
        process.exit(1);
    }
}

testVisionLocal();
