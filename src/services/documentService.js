require('dotenv').config();
const axios = require('axios');
const { withTimeout, retryWithBackoff } = require('../utils/timeout');
const googleVisionService = require('./googleVisionService');

// Timeout para processamento de imagens (60 segundos - imagens podem demorar)
const IMAGE_PROCESSING_TIMEOUT_MS = 60000;

class DocumentService {
  constructor() {
    console.log('[DOC] DocumentService inicializado com Google Vision');
  }

  /**
   * Detecta o tipo de imagem pelos magic numbers (primeiros bytes)
   * @param {Buffer} buffer - Buffer da imagem
   * @returns {Object} - { mimeType, fileExtension }
   */
  detectImageType(buffer) {
    const firstBytes = buffer.slice(0, 12);

    // Log dos primeiros bytes para debug
    const hexPreview = Array.from(firstBytes.slice(0, 8))
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
    console.log('[DOC] Primeiros bytes (hex):', hexPreview);

    // JPEG: FF D8 FF
    if (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8 && firstBytes[2] === 0xFF) {
      return { mimeType: 'image/jpeg', fileExtension: 'JPG' };
    }
    // PNG: 89 50 4E 47
    else if (firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4E && firstBytes[3] === 0x47) {
      return { mimeType: 'image/png', fileExtension: 'PNG' };
    }
    // GIF: 47 49 46 38
    else if (firstBytes[0] === 0x47 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x38) {
      return { mimeType: 'image/gif', fileExtension: 'GIF' };
    }
    // WEBP: RIFF...WEBP
    else if (firstBytes[0] === 0x52 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x46 &&
      firstBytes[8] === 0x57 && firstBytes[9] === 0x45 && firstBytes[10] === 0x42 && firstBytes[11] === 0x50) {
      return { mimeType: 'image/webp', fileExtension: 'WEBP' };
    }
    // BMP: 42 4D
    else if (firstBytes[0] === 0x42 && firstBytes[1] === 0x4D) {
      return { mimeType: 'image/bmp', fileExtension: 'BMP' };
    }
    // PDF: 25 50 44 46 (%PDF)
    else if (firstBytes[0] === 0x25 && firstBytes[1] === 0x50 && firstBytes[2] === 0x44 && firstBytes[3] === 0x46) {
      return { mimeType: 'application/pdf', fileExtension: 'PDF' };
    }

    // Padrão: assume JPEG
    console.log('[DOC] ⚠️ Tipo não identificado pelos magic numbers, usando JPEG como padrão');
    return { mimeType: 'image/jpeg', fileExtension: 'JPG' };
  }

  /**
   * Processa imagem usando Google Vision API
   * @param {Buffer|string} imageBufferOrUrl - Buffer da imagem ou URL para download
   * @param {Object} messageKey - Chave da mensagem (opcional, para Evolution API)
   * @returns {Promise<Object>} - Resultado do OCR com texto extraído
   */
  async processImage(imageBufferOrUrl, messageKey = null) {
    try {
      console.log('[DOC] Iniciando processamento com Google Vision...');

      let imageBuffer;

      // Se recebeu uma string (URL), faz o download
      if (typeof imageBufferOrUrl === 'string') {
        const imageUrl = imageBufferOrUrl;
        console.log('[DOC] Baixando imagem da URL:', imageUrl.substring(0, 100) + '...');

        try {
          const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
              'apikey': process.env.EVOLUTION_API_KEY || '',
              'User-Agent': 'Lumiz-Backend/1.0',
              'Accept': 'image/*,application/pdf,*/*'
            }
          });

          imageBuffer = Buffer.from(response.data);

          // Verifica se o buffer baixado é válido
          const { mimeType } = this.detectImageType(imageBuffer);
          if (mimeType === 'image/jpeg' && imageBuffer.length > 0) {
            // Se detectou JPEG mas os bytes não são FF D8 FF, pode ser falso positivo do default
            // Mas detectImageType retorna JPEG como default, então precisamos checar os bytes
            if (imageBuffer[0] !== 0xFF || imageBuffer[1] !== 0xD8) {
              console.log('[DOC] ⚠️ Buffer baixado não parece ser um JPEG válido (magic numbers incorretos)');
              imageBuffer = null; // Força fallback
            } else {
              console.log('[DOC] ✅ Arquivo baixado via URL e validado');
            }
          } else if (mimeType === 'application/pdf' || mimeType === 'image/png' || mimeType === 'image/webp') {
            console.log('[DOC] ✅ Arquivo baixado via URL e validado:', mimeType);
          } else {
            console.log('[DOC] ⚠️ Tipo de arquivo suspeito:', mimeType);
            // Não anula imageBuffer aqui para dar uma chance, mas o log avisa
          }

        } catch (downloadError) {
          console.error('[DOC] ⚠️ Erro ao baixar via URL direta:', downloadError.message);
          imageBuffer = null;
        }
      } else {
        // Já é um buffer
        imageBuffer = imageBufferOrUrl;
      }

      // Fallback: Se não tem buffer válido e tem messageKey, tenta Evolution API
      if ((!imageBuffer || imageBuffer.length === 0) && messageKey) {
        try {
          console.log('[DOC] Tentando baixar via Evolution API (fallback)...');
          // Lazy load para evitar dependência circular se houver
          const evolutionService = require('./evolutionService');
          const mediaResponse = await evolutionService.downloadMedia(messageKey, 'image');

          if (mediaResponse && mediaResponse.data) {
            imageBuffer = mediaResponse.data;
            console.log('[DOC] ✅ Arquivo baixado via Evolution API');
            console.log('[DOC] Tamanho:', imageBuffer.length, 'bytes');
          }
        } catch (evolutionError) {
          console.log('[DOC] ❌ Erro ao baixar via Evolution API:', evolutionError.message);
        }
      }

      if (!imageBuffer || imageBuffer.length === 0) {
        throw new Error('Não foi possível obter a imagem (URL falhou e fallback falhou)');
      }

      console.log('[DOC] Tamanho do buffer final:', imageBuffer.length, 'bytes');

      // Detecta o tipo da imagem (apenas para log)
      const { mimeType, fileExtension } = this.detectImageType(imageBuffer);
      console.log('[DOC] Tipo detectado:', mimeType, '(' + fileExtension + ')');

      // Chama Google Vision Service
      // O serviço já retorna o JSON estruturado processado pelo Gemini
      const result = await withTimeout(
        googleVisionService.processImage(imageBuffer, mimeType),
        IMAGE_PROCESSING_TIMEOUT_MS,
        'Timeout ao processar imagem com Google Vision'
      );

      console.log('[DOC] ✅ Processamento concluído com sucesso');
      return result;

    } catch (error) {
      console.error('[DOC] ❌ Erro no processamento de imagem:', error.message);
      return {
        tipo_documento: 'erro',
        transacoes: [],
        erro: error.message || 'Erro desconhecido ao processar imagem'
      };
    }
  }

  async processDocumentFromBuffer(buffer, mimeType, fileName) {
    console.log(`[DOC] Processando buffer de documento: ${mimeType}, ${buffer.length} bytes`);

    const { fileExtension } = this.detectImageType(buffer);

    // Se for PDF, processa direto com Gemini 2.0 (Multimodal)
    if (mimeType === 'application/pdf' || fileExtension === 'PDF') {
      console.log('[DOC] PDF detectado! Enviando direto para Gemini 2.0 Flash...');
      const geminiService = require('./geminiService');

      const dataHoje = new Date().toISOString().split('T')[0];
      const prompt = `
TAREFA: Analisar este documento financeiro (PDF) e extrair informações estruturadas.

DATA DE HOJE: ${dataHoje}

TIPOS DE DOCUMENTO:
1. BOLETO
2. EXTRATO BANCÁRIO
3. COMPROVANTE DE PAGAMENTO PIX
4. COMPROVANTE DE PAGAMENTO
5. NOTA FISCAL
6. FATURA DE CARTÃO
7. RECIBO

EXTRAÇÃO:
- tipo_documento: tipo identificado (boleto, extrato, comprovante_pix, comprovante, nota_fiscal, fatura, recibo, nao_identificado)
- transacoes: array de transações encontradas:
  - tipo: "entrada" (recebi dinheiro) ou "saida" (paguei dinheiro)
  - valor: número (positivo)
  - categoria: nome da pessoa/empresa ou descrição curta
  - data: YYYY-MM-DD
  - descricao: detalhes adicionais

REGRAS:
- Boleto/NF/Fatura = SAÍDA
- PIX: Verifique "De" e "Para". Se "Para" é o usuário (clínica), é ENTRADA. Se "De" é o usuário, é SAÍDA.
- Na dúvida do PIX, se for Comprovante de Transferência que EUN enviei, é SAÍDA.
- Tente extrair o máximo de transações possível (ex: várias linhas de um extrato).

RETORNE APENAS JSON:
{
  "tipo_documento": "...",
  "transacoes": [{ "tipo": "...", "valor": 0.0, "categoria": "...", "data": "...", "descricao": "..." }]
}
`;
      return await geminiService.processDocument(buffer, 'application/pdf', prompt);
    }

    // Se for imagem, usa o fluxo padrão (Vision -> Gemini)
    return this.processImage(buffer);
  }


  /**
   * Formata o resultado do OCR para exibição ao usuário
   * @param {Object} result - Resultado do processamento
   * @returns {string} - Mensagem formatada
   */
  formatDocumentSummary(result) {
    if (result.tipo_documento === 'erro') {
      let errorMessage = `Erro ao analisar documento 😢\n\n`;

      if (result.erro) {
        if (result.erro.includes('não é válida')) {
          errorMessage += `A imagem não é válida. Por favor, envie uma foto em formato JPEG ou PNG.\n\n`;
        } else if (result.erro.includes('muito grande')) {
          errorMessage += `A imagem é muito grande. Por favor, envie uma imagem menor.\n\n`;
        } else {
          errorMessage += `Detalhes: ${result.erro}\n\n`;
        }
      }

      errorMessage += `Tente enviar novamente ou registre manualmente.`;
      return errorMessage;
    }

    if (result.tipo_documento === 'nao_identificado') {
      return `Não consegui identificar o documento 🤔\n\nTente enviar:\n- Foto mais nítida\n- PDF/imagem do boleto\n- Screenshot do extrato\n\nOu registre manualmente.`;
    }

    const tipoNome = {
      'boleto': 'BOLETO',
      'extrato': 'EXTRATO BANCÁRIO',
      'comprovante_pix': 'COMPROVANTE PIX',
      'comprovante': 'COMPROVANTE',
      'nota_fiscal': 'NOTA FISCAL',
      'fatura': 'FATURA DE CARTÃO',
      'recibo': 'RECIBO'
    };

    let message = `📄 *${tipoNome[result.tipo_documento] || result.tipo_documento.toUpperCase()}*\n\n`;

    if (!result.transacoes || result.transacoes.length === 0) {
      message += `Não encontrei transações neste documento.\n\nRegistre manualmente.`;
      return message;
    }

    message += `📋 Encontrei *${result.transacoes.length} transação(ões)*:\n\n`;

    result.transacoes.forEach((t, index) => {
      const emoji = t.tipo === 'entrada' ? '💰' : '💸';
      const tipoTexto = t.tipo === 'entrada' ? 'RECEITA' : 'CUSTO';

      let dataFormatada = t.data;
      try {
        if (t.data && t.data.includes('-')) {
          const [ano, mes, dia] = t.data.split('-');
          dataFormatada = `${dia}/${mes}`;
        }
      } catch (e) {
        // Mantém original se falhar
      }

      message += `${index + 1}. ${emoji} *${tipoTexto}*\n`;
      message += `   💵 R$ ${t.valor.toFixed(2)}\n`;
      message += `   📂 ${t.categoria}\n`;
      if (t.descricao) {
        message += `   📝 ${t.descricao}\n`;
      }
      message += `   📅 ${dataFormatada}\n\n`;
    });

    if (result.transacoes.length === 1) {
      message += `Responda *SIM* pra registrar ou *NÃO* pra cancelar`;
    } else {
      message += `Responda *SIM* pra registrar TODAS ou *NÃO* pra cancelar`;
    }

    return message;
  }
}

module.exports = new DocumentService();
