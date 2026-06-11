/**
 * Copy de WhatsApp para mensagens de áudio.
 */

const audioUnavailable = () =>
  'Ainda não consigo entender áudios por aqui.\n\nPode me mandar a mesma informação por texto?';

const audioDownloadFailed = () =>
  'Não consegui acessar o áudio.\n\nTente enviar novamente ou me mande por texto.';

const audioEmptyTranscription = () =>
  'Não consegui entender o áudio com segurança.\n\nTente falar de novo ou me mande por texto.';

const audioProcessingFailed = () =>
  'Não consegui processar esse áudio agora.\n\nTente novamente ou me mande por texto.';

const transcriptionHeader = (text = '') => {
  const clean = String(text || '').trim();
  const summary = clean.length > 240 ? `${clean.slice(0, 240).trim()}...` : clean;
  return `🎤 _Entendi assim:_ "${summary}"`;
};

module.exports = {
  audioUnavailable,
  audioDownloadFailed,
  audioEmptyTranscription,
  audioProcessingFailed,
  transcriptionHeader
};
