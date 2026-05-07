const OpenAI = require('openai');
const { withTimeout, retryWithBackoff } = require('../utils/timeout');
require('dotenv').config();

const AUDIO_TRANSCRIPTION_TIMEOUT_MS = 60000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // limite atual da API Whisper
const DEFAULT_MODEL = process.env.WHISPER_MODEL || 'whisper-1';
const DEFAULT_LANGUAGE = process.env.WHISPER_LANGUAGE || 'pt';

const SUPPORTED_MIME_TYPES = new Set([
  'audio/ogg',
  'audio/oga',
  'audio/opus',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/webm'
]);

const MIME_TO_EXTENSION = {
  'audio/ogg': 'ogg',
  'audio/oga': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm'
};

class AudioTranscriptionService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('[AUDIO] OPENAI_API_KEY não configurada. Transcrição de áudio desativada.');
      this.client = null;
      return;
    }
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  isEnabled() {
    return Boolean(this.client);
  }

  isSupportedMimeType(mimeType) {
    if (!mimeType) return false;
    return SUPPORTED_MIME_TYPES.has(String(mimeType).toLowerCase());
  }

  /**
   * Transcreve um buffer de áudio em texto usando Whisper.
   * @param {Buffer} buffer
   * @param {string} mimeType
   * @returns {Promise<{text: string, durationMs: number, model: string}>}
   */
  async transcribe(buffer, mimeType = 'audio/ogg') {
    if (!this.client) {
      throw new Error('Transcrição de áudio indisponível: OPENAI_API_KEY não configurada.');
    }
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Buffer de áudio vazio ou inválido.');
    }
    if (buffer.length > MAX_AUDIO_BYTES) {
      throw new Error(`Áudio acima do limite suportado (${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))} MB).`);
    }

    const normalizedMime = String(mimeType || 'audio/ogg').toLowerCase();
    const extension = MIME_TO_EXTENSION[normalizedMime] || 'ogg';
    const fileName = `audio.${extension}`;

    const startedAt = Date.now();
    try {
      const fileLike = await OpenAI.toFile(buffer, fileName, { type: normalizedMime });
      const response = await retryWithBackoff(
        () => withTimeout(
          this.client.audio.transcriptions.create({
            file: fileLike,
            model: DEFAULT_MODEL,
            language: DEFAULT_LANGUAGE,
            response_format: 'json',
            temperature: 0
          }),
          AUDIO_TRANSCRIPTION_TIMEOUT_MS,
          `Timeout ao transcrever áudio com Whisper (${AUDIO_TRANSCRIPTION_TIMEOUT_MS / 1000}s)`
        ),
        2,
        1000
      );

      const text = (response?.text || '').trim();
      return {
        text,
        durationMs: Date.now() - startedAt,
        model: DEFAULT_MODEL
      };
    } catch (error) {
      const message = String(error?.message || '');
      if (message.includes('rate limit')) {
        throw new Error('Limite de requisições da OpenAI atingido. Tente novamente em alguns instantes.');
      }
      console.error('[AUDIO] Falha ao transcrever áudio:', message);
      throw error;
    }
  }
}

module.exports = new AudioTranscriptionService();
