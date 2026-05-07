/**
 * Testes unitários para AudioTranscriptionService.
 * Foca em validação de inputs e contratos públicos — a chamada real ao Whisper
 * é mockada para evitar dependência de OPENAI_API_KEY em CI.
 */

require('dotenv').config();
process.env.NODE_ENV = 'test';

describe('AudioTranscriptionService', () => {
  let originalKey;

  beforeAll(() => {
    originalKey = process.env.OPENAI_API_KEY;
  });

  afterAll(() => {
    process.env.OPENAI_API_KEY = originalKey;
  });

  beforeEach(() => {
    jest.resetModules();
  });

  it('expõe isEnabled() = false quando OPENAI_API_KEY não configurada', () => {
    delete process.env.OPENAI_API_KEY;
    const svc = require('../../src/services/audioTranscriptionService');
    expect(svc.isEnabled()).toBe(false);
  });

  it('rejeita transcribe quando service desabilitado', async () => {
    delete process.env.OPENAI_API_KEY;
    const svc = require('../../src/services/audioTranscriptionService');
    await expect(svc.transcribe(Buffer.from('abc'), 'audio/ogg')).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it('rejeita buffer vazio', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const svc = require('../../src/services/audioTranscriptionService');
    await expect(svc.transcribe(Buffer.alloc(0), 'audio/ogg')).rejects.toThrow(/vazio/);
    await expect(svc.transcribe(null, 'audio/ogg')).rejects.toThrow();
  });

  it('aceita os mime types comuns de áudio do WhatsApp', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const svc = require('../../src/services/audioTranscriptionService');
    expect(svc.isSupportedMimeType('audio/ogg')).toBe(true);
    expect(svc.isSupportedMimeType('audio/mpeg')).toBe(true);
    expect(svc.isSupportedMimeType('audio/m4a')).toBe(true);
    expect(svc.isSupportedMimeType('image/png')).toBe(false);
    expect(svc.isSupportedMimeType('')).toBe(false);
    expect(svc.isSupportedMimeType(null)).toBe(false);
  });
});
