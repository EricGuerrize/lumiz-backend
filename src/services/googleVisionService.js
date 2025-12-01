const vision = require('@google-cloud/vision');
const axios = require('axios');

class GoogleVisionService {
    constructor() {
        this.client = null;
        this.apiKey = null;
        this.init();
    }

    init() {
        const key = process.env.GOOGLE_VISION_API_KEY;

        if (key) {
            // Verifica se é um JSON (Service Account) ou String (API Key)
            if (key.trim().startsWith('{')) {
                try {
                    const credentials = JSON.parse(key);
                    this.client = new vision.ImageAnnotatorClient({ credentials });
                    console.log('[VISION] Cliente inicializado com credenciais JSON (Service Account)');
                } catch (e) {
                    console.error('[VISION] ❌ Erro ao fazer parse das credenciais JSON:', e.message);
                }
            } else {
                this.apiKey = key;
                console.log('[VISION] Configurado para usar REST API com API Key');
            }
        } else {
            // Tenta usar credenciais padrão do ambiente (GOOGLE_APPLICATION_CREDENTIALS)
            // A lib do Google tenta carregar automaticamente
            try {
                this.client = new vision.ImageAnnotatorClient();
                // Não temos como saber se deu certo até tentar usar, mas instanciou
                console.log('[VISION] Cliente inicializado (tentando credenciais padrão)');
            } catch (e) {
                console.log('[VISION] Nenhuma credencial configurada inicialmente');
            }
        }
    }

    /**
     * Extrai texto de uma imagem usando Google Cloud Vision
     * @param {Buffer} imageBuffer - Buffer da imagem
     * @returns {Promise<string>} - Texto extraído
     */
    async extractTextFromImage(imageBuffer) {
        try {
            // Prioridade 1: Cliente oficial (Service Account)
            if (this.client) {
                try {
                    const [result] = await this.client.textDetection(imageBuffer);
                    const detections = result.textAnnotations;

                    if (!detections || detections.length === 0) {
                        return '';
                    }

                    // O primeiro elemento contém todo o texto
                    return detections[0].description;
                } catch (clientError) {
                    console.warn('[VISION] ⚠️ Erro com client library:', clientError.message);
                    // Se falhar e tivermos API Key, tentamos o fallback
                    if (!this.apiKey) throw clientError;
                }
            }

            // Prioridade 2: REST API com API Key
            if (this.apiKey) {
                console.log('[VISION] Usando REST API fallback...');
                const base64Image = imageBuffer.toString('base64');

                const response = await axios.post(
                    `https://vision.googleapis.com/v1/images:annotate?key=${this.apiKey}`,
                    {
                        requests: [
                            {
                                image: {
                                    content: base64Image
                                },
                                features: [
                                    {
                                        type: 'TEXT_DETECTION'
                                    }
                                ]
                            }
                        ]
                    }
                );

                const detections = response.data.responses[0].textAnnotations;

                if (!detections || detections.length === 0) {
                    return '';
                }

                return detections[0].description;
            }

            throw new Error('Nenhuma credencial válida configurada para Google Vision');
        } catch (error) {
            console.error('[VISION] ❌ Erro ao extrair texto:', error.message);
            throw error;
        }
    }
}

module.exports = new GoogleVisionService();
