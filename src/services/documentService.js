const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

class DocumentService {
  constructor() {
    this.model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  }

  async processImage(imageUrl) {
    try {
      console.log('[DOC] Processando imagem:', imageUrl);

      // Baixa a imagem
      const imageResponse = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        headers: {
          'apikey': process.env.EVOLUTION_API_KEY
        }
      });

      const imageBuffer = Buffer.from(imageResponse.data);
      const base64Image = imageBuffer.toString('base64');

      // DETECÇÃO DE MIME TYPE usando magic numbers (método confiável e compatível)
      console.log('[DOC] ===== INÍCIO DETECÇÃO MIME TYPE =====');
      console.log('[DOC] Tamanho do buffer:', imageBuffer.length, 'bytes');
      const headerMimeType = imageResponse.headers['content-type'];
      console.log('[DOC] MIME type do header HTTP:', headerMimeType);

      // Validação básica do buffer
      if (!imageBuffer || imageBuffer.length === 0) {
        throw new Error('Buffer de imagem vazio ou inválido');
      }

      // Detecta pelo magic number (primeiros bytes) - método mais confiável
      const firstBytes = imageBuffer.slice(0, 12);
      const hexPreview = Array.from(firstBytes.slice(0, 8))
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
      console.log('[DOC] Primeiros bytes (hex):', hexPreview);
      let mimeType = null;

      // JPEG: FF D8 FF
      if (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8 && firstBytes[2] === 0xFF) {
        mimeType = 'image/jpeg';
        console.log('[DOC] ✅ Detectado: JPEG (FF D8 FF)');
      }
      // PNG: 89 50 4E 47 0D 0A 1A 0A
      else if (firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4E && firstBytes[3] === 0x47) {
        mimeType = 'image/png';
        console.log('[DOC] ✅ Detectado: PNG (89 50 4E 47)');
      }
      // GIF: 47 49 46 38 (GIF8)
      else if (firstBytes[0] === 0x47 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x38) {
        mimeType = 'image/gif';
        console.log('[DOC] ✅ Detectado: GIF (47 49 46 38)');
      }
      // WEBP: RIFF...WEBP
      else if (firstBytes[0] === 0x52 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x46 &&
               firstBytes[8] === 0x57 && firstBytes[9] === 0x45 && firstBytes[10] === 0x42 && firstBytes[11] === 0x50) {
        mimeType = 'image/webp';
        console.log('[DOC] ✅ Detectado: WEBP (RIFF...WEBP)');
      }
      // BMP: 42 4D
      else if (firstBytes[0] === 0x42 && firstBytes[1] === 0x4D) {
        mimeType = 'image/bmp';
        console.log('[DOC] ✅ Detectado: BMP (42 4D)');
      }
      else {
        console.log('[DOC] ⚠️ Tipo não identificado pelos magic numbers');
      }

      // Fallback: usa header HTTP se válido
      if (!mimeType || !mimeType.startsWith('image/')) {
        if (headerMimeType && headerMimeType.startsWith('image/') && headerMimeType !== 'application/octet-stream') {
          mimeType = headerMimeType;
          console.log('[DOC] ✅ Usando MIME type do header HTTP:', mimeType);
        } else {
          // Último recurso: força JPEG (formato mais comum e suportado)
          mimeType = 'image/jpeg';
          console.log('[DOC] ⚠️ Forçando JPEG como padrão seguro');
        }
      }

      // VALIDAÇÃO FINAL ABSOLUTA - nunca permite application/octet-stream
      if (mimeType === 'application/octet-stream' || !mimeType || !mimeType.startsWith('image/')) {
        console.error('[DOC] ❌ ERRO: MIME type inválido detectado:', mimeType);
        mimeType = 'image/jpeg';
        console.log('[DOC] ✅ Corrigido para JPEG');
      }

      console.log('[DOC] ===== MIME TYPE FINAL: ' + mimeType + ' =====');

      const dataHoje = new Date().toISOString().split('T')[0];

      const prompt = `
TAREFA: Analisar esta imagem de documento financeiro e extrair informações.

TIPOS DE DOCUMENTO:
1. BOLETO: código de barras, valor, vencimento, beneficiário, linha digitável
2. EXTRATO BANCÁRIO: lista de transações com datas e valores, créditos e débitos
3. COMPROVANTE DE PAGAMENTO PIX: comprovante de transferência PIX, valor, data/hora, destinatário/remetente, chave PIX
4. COMPROVANTE DE PAGAMENTO: valor pago, data, destinatário, qualquer comprovante de pagamento
5. NOTA FISCAL: valor total, fornecedor, data, itens, CNPJ, número da nota
6. FATURA DE CARTÃO: valor total, parcelas, data vencimento, bandeira
7. RECIBO: valor, serviço prestado, data

EXTRAÇÃO:
- tipo_documento: tipo identificado (boleto, extrato, comprovante_pix, comprovante, nota_fiscal, fatura, recibo)
- transacoes: array de transações encontradas, cada uma com:
  - tipo: "entrada" ou "saida"
  - valor: número (sempre positivo)
  - categoria: nome/descrição (ex: "Fornecedor XYZ", "Cliente Maria", "Pix Recebido", "Pix Enviado")
  - data: data da transação (formato YYYY-MM-DD)
  - descricao: detalhes adicionais (ex: "Boleto vencimento 20/11", "Pix de João Silva")

REGRAS IMPORTANTES:
- Para BOLETO/NOTA FISCAL/FATURA: sempre é SAÍDA (custo a pagar)
- Para COMPROVANTE PIX: 
  * Procure por: "PIX", "Transferência PIX", "Chave PIX", "Comprovante de Transferência"
  * Se mostra "Você recebeu" / "Crédito" / seta apontando para você = tipo "entrada"
  * Se mostra "Você enviou" / "Débito" / seta apontando para fora = tipo "saida"
  * Identifique pela direção da seta, texto "recebido/enviado", ou contexto visual
  * Extraia valor, data/hora, nome do remetente/destinatário
- Para NOTA FISCAL: procure por "NF", "NFe", "Nota Fiscal", CNPJ, valor total, fornecedor
- Para EXTRATO: analise cada linha (crédito=entrada, débito=saída)
- Para COMPROVANTE genérico: analise o contexto (pagamento=saída, recebimento=entrada)
- Se não conseguir identificar, retorne tipo_documento: "nao_identificado"
- SEMPRE extraia pelo menos uma transação se identificar o documento
- Seja assertivo: se identificar qualquer documento financeiro, extraia os dados mesmo que incompletos

EXEMPLOS DE RESPOSTA:

Boleto:
{
  "tipo_documento": "boleto",
  "transacoes": [{
    "tipo": "saida",
    "valor": 1500.00,
    "categoria": "Fornecedor XYZ",
    "data": "${dataHoje}",
    "descricao": "Boleto vencimento 20/11"
  }]
}

Extrato:
{
  "tipo_documento": "extrato",
  "transacoes": [
    {
      "tipo": "saida",
      "valor": 800.00,
      "categoria": "Aluguel",
      "data": "2024-11-10",
      "descricao": "Débito automático"
    },
    {
      "tipo": "entrada",
      "valor": 2500.00,
      "categoria": "Pix Recebido",
      "data": "2024-11-12",
      "descricao": "Cliente Maria"
    }
  ]
}

Comprovante PIX (recebido):
{
  "tipo_documento": "comprovante_pix",
  "transacoes": [{
    "tipo": "entrada",
    "valor": 1500.00,
    "categoria": "Pix Recebido",
    "data": "${dataHoje}",
    "descricao": "Pix de João Silva"
  }]
}

Comprovante PIX (enviado/pago):
{
  "tipo_documento": "comprovante_pix",
  "transacoes": [{
    "tipo": "saida",
    "valor": 500.00,
    "categoria": "Pix Enviado",
    "data": "${dataHoje}",
    "descricao": "Pix para Fornecedor ABC"
  }]
}

Nota Fiscal:
{
  "tipo_documento": "nota_fiscal",
  "transacoes": [{
    "tipo": "saida",
    "valor": 3200.00,
    "categoria": "Fornecedor XYZ",
    "data": "${dataHoje}",
    "descricao": "NF 12345 - Insumos"
  }]
}

Não identificado:
{
  "tipo_documento": "nao_identificado",
  "transacoes": []
}

RESPONDA APENAS O JSON, SEM TEXTO ADICIONAL:
`;

      // VALIDAÇÃO CRÍTICA FINAL - nunca permite application/octet-stream
      if (!mimeType || mimeType === 'application/octet-stream' || !mimeType.startsWith('image/')) {
        console.error('[DOC] ⚠️ ERRO CRÍTICO: mimeType inválido detectado:', mimeType);
        mimeType = 'image/jpeg'; // Força JPEG
        console.log('[DOC] ✅ MIME type corrigido para:', mimeType);
      }

      // Validação dupla antes de criar imagePart
      if (mimeType === 'application/octet-stream') {
        throw new Error('MIME type application/octet-stream não pode ser enviado ao Gemini');
      }

      // Validação do base64
      if (!base64Image || base64Image.length === 0) {
        throw new Error('Base64 da imagem está vazio');
      }

      // Validação do tamanho (Gemini tem limite de ~20MB para base64)
      const base64SizeMB = (base64Image.length * 3) / 4 / 1024 / 1024;
      console.log('[DOC] Tamanho da imagem (base64):', base64Image.length, 'bytes (~', base64SizeMB.toFixed(2), 'MB)');
      
      if (base64SizeMB > 20) {
        throw new Error(`Imagem muito grande: ${base64SizeMB.toFixed(2)}MB (limite: 20MB)`);
      }

      console.log('[DOC] ✅ Enviando para Gemini com mimeType:', mimeType);

      const imagePart = {
        inlineData: {
          data: base64Image,
          mimeType: mimeType
        }
      };

      // Validação final do objeto antes de enviar
      if (imagePart.inlineData.mimeType === 'application/octet-stream') {
        throw new Error('MIME type ainda inválido no imagePart - abortando envio');
      }

      try {
        console.log('[DOC] Chamando Gemini API...');
        const result = await this.model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();
        console.log('[DOC] ✅ Resposta do Gemini recebida, tamanho:', text.length, 'caracteres');

        // Remove markdown code blocks se houver
        const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        return JSON.parse(jsonText);
      } catch (geminiError) {
        console.error('[DOC] ❌ Erro ao chamar Gemini API:', geminiError.message);
        
        // Tratamento específico para erros conhecidos
        if (geminiError.message && geminiError.message.includes('Provided image is not valid')) {
          throw new Error('A imagem enviada não é válida. Verifique se é uma imagem JPEG, PNG ou WEBP válida.');
        }
        
        if (geminiError.message && geminiError.message.includes('mimeType')) {
          throw new Error(`Erro de MIME type: ${mimeType}. A imagem pode estar corrompida.`);
        }
        
        // Re-throw com contexto adicional
        throw new Error(`Erro ao processar imagem com Gemini: ${geminiError.message}`);
      }
    } catch (error) {
      console.error('[DOC] ❌ Erro ao processar imagem:', error.message);
      console.error('[DOC] Stack trace:', error.stack);
      return {
        tipo_documento: 'erro',
        transacoes: [],
        erro: error.message || 'Erro desconhecido ao processar imagem'
      };
    }
  }

  formatDocumentSummary(result) {
    if (result.tipo_documento === 'erro') {
      let errorMessage = `Erro ao analisar documento 😢\n\n`;
      
      if (result.erro) {
        // Mensagens mais específicas para o usuário
        if (result.erro.includes('não é válida')) {
          errorMessage += `A imagem não é válida. Por favor, envie uma foto em formato JPEG ou PNG.\n\n`;
        } else if (result.erro.includes('muito grande')) {
          errorMessage += `A imagem é muito grande. Por favor, envie uma imagem menor.\n\n`;
        } else if (result.erro.includes('MIME type')) {
          errorMessage += `Erro ao identificar o tipo da imagem. Tente enviar novamente.\n\n`;
        } else {
          errorMessage += `Detalhes: ${result.erro}\n\n`;
        }
      }
      
      errorMessage += `Tente:\n- Enviar uma foto mais nítida\n- Verificar se é JPEG ou PNG\n- Ou registre manualmente:\n"Insumos 3200"`;
      
      return errorMessage;
    }

    if (result.tipo_documento === 'nao_identificado') {
      return `Não consegui identificar o documento 🤔\n\nTente enviar:\n- Foto mais nítida\n- PDF/imagem do boleto\n- Screenshot do extrato\n\nOu registre manualmente:\n"Insumos 3200"`;
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

    if (result.transacoes.length === 0) {
      message += `Não encontrei transações neste documento.\n\nRegistre manualmente:\n"Insumos 3200"`;
      return message;
    }

    message += `📋 Encontrei *${result.transacoes.length} transação(ões)*:\n\n`;

    result.transacoes.forEach((t, index) => {
      const emoji = t.tipo === 'entrada' ? '💰' : '💸';
      const tipoTexto = t.tipo === 'entrada' ? 'RECEITA' : 'CUSTO';
      const data = new Date(t.data).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit'
      });

      message += `${index + 1}. ${emoji} *${tipoTexto}*\n`;
      message += `   💵 R$ ${t.valor.toFixed(2)}\n`;
      message += `   📂 ${t.categoria}\n`;
      if (t.descricao) {
        message += `   📝 ${t.descricao}\n`;
      }
      message += `   📅 ${data}\n\n`;
    });

    if (result.transacoes.length === 1) {
      message += `Responde *SIM* pra registrar ou *NÃO* pra cancelar`;
    } else {
      message += `Responde *SIM* pra registrar TODAS ou *NÃO* pra cancelar`;
    }

    return message;
  }
}

module.exports = new DocumentService();
