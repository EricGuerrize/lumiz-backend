const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { withTimeout, retryWithBackoff } = require('../utils/timeout');
require('dotenv').config();

// Timeout para processamento de imagens (60 segundos - imagens podem demorar)
const IMAGE_PROCESSING_TIMEOUT_MS = 60000;

// Valida API key antes de inicializar
if (!process.env.GEMINI_API_KEY) {
  console.error('[DOC] ❌ GEMINI_API_KEY não configurada!');
  throw new Error('GEMINI_API_KEY não configurada no .env');
}

// Valida formato da API key (deve começar com letras/números)
if (process.env.GEMINI_API_KEY.trim().length < 20) {
  console.error('[DOC] ❌ GEMINI_API_KEY parece inválida (muito curta)');
  throw new Error('GEMINI_API_KEY parece inválida. Verifique se está correta no .env');
}

console.log('[DOC] ✅ GEMINI_API_KEY configurada (tamanho:', process.env.GEMINI_API_KEY.length, 'chars)');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

class DocumentService {
  constructor() {
    // Usando modelo que funciona: gemini-2.0-flash-exp (mesmo usado em outros serviços)
    // gemini-1.5-flash não está disponível na API v1beta
    // gemini-2.0-flash-exp suporta visão (imagens) e está funcionando
    console.log('[DOC] Inicializando modelo Gemini...');
    console.log('[DOC] API Key presente:', process.env.GEMINI_API_KEY ? 'SIM' : 'NÃO');
    console.log('[DOC] API Key (primeiros 10 chars):', process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 10) + '...' : 'N/A');
    
    try {
      this.model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
      console.log('[DOC] ✅ Modelo gemini-2.0-flash-exp inicializado com sucesso');
    } catch (error) {
      console.error('[DOC] ❌ Erro ao inicializar modelo:', error.message);
      throw new Error(`Erro ao inicializar modelo Gemini: ${error.message}`);
    }
    
    // Tenta carregar OpenAI se disponível (para usar como fallback ou opção preferencial)
    this.openaiService = null;
    try {
      this.openaiService = require('./openaiService');
      if (this.openaiService.client) {
        console.log('[DOC] ✅ OpenAI disponível - será usado para processamento de imagens');
      }
    } catch (error) {
      console.log('[DOC] OpenAI não disponível - usando apenas Gemini');
    }
    
    // Configura qual IA usar
    // PRIORIDADE: OpenAI (se disponível) > Gemini (fallback)
    // OpenAI é mais confiável para análise de documentos/imagens
    this.useOpenAI = this.openaiService?.client !== null && this.openaiService?.client !== undefined;
    
    if (this.useOpenAI) {
      console.log('[DOC] ✅ OpenAI disponível - será usado como PRIMÁRIO para processamento de imagens');
    } else {
      console.log('[DOC] ⚠️ OpenAI não disponível - usando Gemini como fallback');
      console.log('[DOC] 💡 Dica: Configure OPENAI_API_KEY para melhor precisão na análise de documentos');
    }
  }

  async processImage(imageUrl, messageKey = null) {
    try {
      console.log('[DOC] ========================================');
      console.log('[DOC] Processando documento:', imageUrl);
      if (messageKey) {
        console.log('[DOC] MessageKey fornecido:', JSON.stringify(messageKey));
      }
      console.log('[DOC] ========================================');

      let imageBuffer;
      let headerMimeType;

      // Valida se tem URL
      if (!imageUrl) {
        throw new Error('URL da imagem não fornecida');
      }

      // Estratégia: Tenta Evolution API primeiro (mais confiável), depois URL direta
      // Evolution API com messageKey é mais confiável que URL direta
      let evolutionError = null;
      let urlError = null;
      
      // PRIORIDADE 1: Evolution API com messageKey (mais confiável)
      if (messageKey && messageKey.remoteJid && messageKey.id) {
        try {
          console.log('[DOC] Tentando baixar via Evolution API (método preferido)...');
          const evolutionService = require('./evolutionService');
          const mediaResponse = await evolutionService.downloadMedia(messageKey, 'image');
          imageBuffer = mediaResponse.data;
          headerMimeType = mediaResponse.contentType;
          console.log('[DOC] ✅ Arquivo baixado via Evolution API');
          console.log('[DOC] Content-Type:', headerMimeType);
          console.log('[DOC] Tamanho:', imageBuffer.length, 'bytes');
        } catch (err) {
          evolutionError = err;
          console.log('[DOC] ⚠️ Erro ao baixar via Evolution API:', err.message);
          console.log('[DOC] Tentando via URL direta como fallback...');
          // Fallback para URL direta se Evolution API falhar
        }
      } else if (messageKey) {
        console.log('[DOC] ⚠️ MessageKey fornecido mas sem remoteJid ou id, tentando URL direta...');
      }

      // PRIORIDADE 2: URL direta (fallback se Evolution API falhar ou não tiver messageKey)
      if (!imageBuffer && imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        try {
          console.log('[DOC] Baixando arquivo via URL direta...');
          const imageResponse = await withTimeout(
            axios.get(imageUrl, {
              responseType: 'arraybuffer',
              timeout: 30000, // 30 segundos para download
              headers: {
                'apikey': process.env.EVOLUTION_API_KEY,
                'User-Agent': 'Lumiz-Backend/1.0',
                'Accept': 'image/*,application/pdf,*/*'
              }
            }),
            30000,
            'Timeout ao baixar arquivo (30s)'
          );

          console.log('[DOC] ✅ Arquivo baixado via URL direta');
          console.log('[DOC] Status HTTP:', imageResponse.status);
          console.log('[DOC] Content-Type:', imageResponse.headers['content-type']);
          console.log('[DOC] Content-Length:', imageResponse.headers['content-length']);

          imageBuffer = Buffer.from(imageResponse.data);
          headerMimeType = imageResponse.headers['content-type'];
        } catch (err) {
          urlError = err;
          console.log('[DOC] ⚠️ Erro ao baixar via URL direta:', err.message);
        }
      }

      // Se ambos métodos falharam, lança erro detalhado
      if (!imageBuffer) {
        let errorMsg = 'Não foi possível baixar a imagem.';
        if (evolutionError && urlError) {
          errorMsg += `\nEvolution API: ${evolutionError.message}\nURL direta: ${urlError.message}`;
        } else if (evolutionError) {
          errorMsg += `\nEvolution API: ${evolutionError.message}`;
        } else if (urlError) {
          errorMsg += `\nURL direta: ${urlError.message}`;
        } else if (!imageUrl && !messageKey) {
          errorMsg += '\nURL e messageKey não fornecidos.';
        } else if (!imageUrl) {
          errorMsg += '\nURL não fornecida pela Evolution API.';
        }
        throw new Error(errorMsg);
      }
      console.log('[DOC] Buffer criado, tamanho:', imageBuffer.length, 'bytes');

      // Validação: buffer não pode estar vazio
      if (!imageBuffer || imageBuffer.length === 0) {
        throw new Error('Buffer vazio - a URL pode estar inválida ou o arquivo corrompido');
      }

      // DETECÇÃO DE MIME TYPE usando magic numbers (método confiável e compatível)
      console.log('[DOC] ===== INÍCIO DETECÇÃO MIME TYPE =====');
      console.log('[DOC] Tamanho do buffer:', imageBuffer.length, 'bytes');
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

      // PDF: 25 50 44 46 (%PDF)
      if (firstBytes[0] === 0x25 && firstBytes[1] === 0x50 && firstBytes[2] === 0x44 && firstBytes[3] === 0x46) {
        mimeType = 'application/pdf';
        console.log('[DOC] ✅ Detectado: PDF (%PDF)');
      }
      // JPEG: FF D8 FF
      else if (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8 && firstBytes[2] === 0xFF) {
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
      if (!mimeType) {
        if (headerMimeType && (headerMimeType.startsWith('image/') || headerMimeType === 'application/pdf')) {
          mimeType = headerMimeType;
          console.log('[DOC] ✅ Usando MIME type do header HTTP:', mimeType);
        } else {
          // Último recurso: força JPEG se parecer imagem, ou erro
          mimeType = 'image/jpeg';
          console.log('[DOC] ⚠️ Forçando JPEG como padrão seguro');
        }
      }

      // Gemini suporta: PDF, JPEG, PNG, WEBP, HEIC, HEIF
      // Validação: aceita apenas formatos suportados
      const supportedFormats = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'];

      if (!supportedFormats.includes(mimeType)) {
        console.log('[DOC] ⚠️ Formato não suportado:', mimeType, '- Tentando processar como image/jpeg');
        mimeType = 'image/jpeg';
      }

      console.log('[DOC] ===== MIME TYPE FINAL: ' + mimeType + ' =====');

      const base64Image = imageBuffer.toString('base64');

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
- Para COMPROVANTE PIX (incluindo Mercado Pago, Nubank, etc): 
  * Procure por: "PIX", "Transferência PIX", "Chave PIX", "Comprovante de Transferência", "Mercado Pago", "Nubank"
  * IMPORTANTE: Identifique a perspectiva do documento:
    - Se o documento mostra que VOCÊ RECEBEU (seção "Para" mostra seu nome/CPF, ou "Crédito", ou seta apontando para você) = tipo "entrada"
    - Se o documento mostra que VOCÊ ENVIOU (seção "De" mostra seu nome/CPF, ou "Débito", ou seta apontando para fora) = tipo "saida"
  * Para MERCADO PAGO especificamente:
    - Procure por seções "De" (remetente) e "Para" (destinatário)
    - Se "De" contém o nome do usuário/clínica = tipo "saida" (você enviou)
    - Se "Para" contém o nome do usuário/clínica = tipo "entrada" (você recebeu)
    - Extraia o nome completo do remetente/destinatário na categoria ou descrição
  * Extraia SEMPRE: valor, data/hora, nome do remetente (De), nome do destinatário (Para)
  * Use o nome do destinatário na categoria se for entrada, ou nome do remetente se for saída
- Para NOTA FISCAL (incluindo DANFE, NFe, NF-e, DANFE):
  * SEMPRE é tipo "saida" (custo/despesa - você comprou algo)
  * Procure por: "NOTA FISCAL", "NF", "NFe", "NF-e", "DANFE", "Emitente", "Fornecedor", "CNPJ", "RECEBEMOS DE"
  * Extraia SEMPRE:
    - Nome do fornecedor/emitente (procure por "Emitente", "RECEBEMOS DE", nome da empresa no topo)
      Exemplo: "ELFA MEDICAMENTOS SA", "RECEBEMOS DE ELFA MEDICAMENTOS SA"
    - Valor total da nota (procure por "VALOR TOTAL", "TOTAL", "Valor a pagar", "TOTAL DA NOTA", números grandes com R$)
    - Data de emissão (procure por "Data de emissão", "Data", "Emissão", formato DD/MM/YYYY)
    - Número da nota fiscal (procure por "N. 000738765", "Número", "NF", "N.")
    - Série da nota (se disponível: "SÉRIE 5")
  * Use o nome do fornecedor na categoria (ex: "ELFA MEDICAMENTOS SA")
  * Inclua número da NF na descrição (ex: "NF 000738765 Série 5 - ELFA MEDICAMENTOS SA")
  * Se não encontrar valor total, procure por valores individuais e some, ou use o maior valor encontrado
- Para COMPROVANTE PIX MERCADO PAGO especificamente:
  * Procure por: "Mercado Pago", "Comprovante de transferência", "De", "Para", "mercado pago" (logo)
  * Identifique seções "De" (remetente) e "Para" (destinatário)
  * IMPORTANTE: O comprovante mostra quem ENVIOU (De) e quem RECEBEU (Para)
  * Como não sabemos o nome do usuário, assuma que quem está enviando o comprovante é quem FEZ a transferência
  * Portanto, SEMPRE será tipo "saida" (custo/pagamento) e use o nome de "Para" na categoria
  * Se no futuro soubermos o nome do usuário, podemos ajustar:
    - Se seu nome está em "De" = tipo "saida" (você enviou)
    - Se seu nome está em "Para" = tipo "entrada" (você recebeu)
  * Extraia: valor (procure por "R$" seguido de número grande), data/hora completa, nomes completos de ambas as partes
  * Use o nome da OUTRA pessoa (não o seu) na categoria
  * Formato de data: "Sábado, 1 de novembro de 2025, às 18:25:31" → "2025-11-01"
  * Exemplo: Se "De: Eric de Sousa Guerrize" e "Para: Romulo Franzoi Bovolon", e você é o Eric:
    - tipo: "saida" (você enviou)
    - categoria: "Romulo Franzoi Bovolon"
    - descricao: "Pix enviado para Romulo Franzoi Bovolon via Mercado Pago"
- Para EXTRATO: analise cada linha (crédito=entrada, débito=saída)
- Para COMPROVANTE genérico: analise o contexto (pagamento=saída, recebimento=entrada)
- Se não conseguir identificar, retorne tipo_documento: "nao_identificado"
- SEMPRE extraia pelo menos uma transação se identificar o documento
- Seja assertivo: se identificar qualquer documento financeiro, extraia os dados mesmo que incompletos
- IMPORTANTE: Para comprovantes PIX, sempre inclua o nome da pessoa/empresa na categoria ou descrição

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

Comprovante PIX Mercado Pago (recebido):
{
  "tipo_documento": "comprovante_pix",
  "transacoes": [{
    "tipo": "entrada",
    "valor": 600.00,
    "categoria": "Eric de Sousa Guerrize",
    "data": "2025-11-01",
    "descricao": "Pix recebido de Eric de Sousa Guerrize via Mercado Pago"
  }]
}

Comprovante PIX Mercado Pago (enviado/pago):
{
  "tipo_documento": "comprovante_pix",
  "transacoes": [{
    "tipo": "saida",
    "valor": 600.00,
    "categoria": "Romulo Franzoi Bovolon",
    "data": "2025-11-01",
    "descricao": "Pix enviado para Romulo Franzoi Bovolon via Mercado Pago"
  }]
}

Comprovante PIX genérico (recebido):
{
  "tipo_documento": "comprovante_pix",
  "transacoes": [{
    "tipo": "entrada",
    "valor": 1500.00,
    "categoria": "João Silva",
    "data": "${dataHoje}",
    "descricao": "Pix recebido de João Silva"
  }]
}

Comprovante PIX genérico (enviado/pago):
{
  "tipo_documento": "comprovante_pix",
  "transacoes": [{
    "tipo": "saida",
    "valor": 500.00,
    "categoria": "Fornecedor ABC",
    "data": "${dataHoje}",
    "descricao": "Pix enviado para Fornecedor ABC"
  }]
}

Nota Fiscal (exemplo ELFA MEDICAMENTOS):
{
  "tipo_documento": "nota_fiscal",
  "transacoes": [{
    "tipo": "saida",
    "valor": 3200.00,
    "categoria": "ELFA MEDICAMENTOS SA",
    "data": "2025-11-24",
    "descricao": "NF 000738765 - ELFA MEDICAMENTOS SA"
  }]
}

Nota Fiscal genérica:
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

      // VALIDAÇÃO CRÍTICA FINAL - aceita imagens e PDFs, bloqueia apenas octet-stream
      const supportedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/heic', 'image/heif'];
      
      if (!mimeType || mimeType === 'application/octet-stream') {
        console.error('[DOC] ⚠️ ERRO CRÍTICO: mimeType inválido detectado:', mimeType);
        // Tenta inferir pelo nome do arquivo ou força JPEG como último recurso
        mimeType = 'image/jpeg';
        console.log('[DOC] ✅ MIME type corrigido para:', mimeType);
      } else if (!supportedMimeTypes.includes(mimeType)) {
        // Se não está na lista de suportados, mas parece ser imagem, tenta processar
        if (mimeType.startsWith('image/')) {
          console.log('[DOC] ⚠️ MIME type não testado, mas parece ser imagem:', mimeType);
          // Mantém o mimeType original se for imagem
        } else {
          console.error('[DOC] ⚠️ MIME type não suportado:', mimeType);
          throw new Error(`Tipo de arquivo não suportado: ${mimeType}. Use PDF, JPEG, PNG ou WEBP.`);
        }
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

      // PRIORIDADE 1: OpenAI GPT-4 Vision (mais confiável para documentos/imagens)
      if (this.useOpenAI && this.openaiService?.client) {
        try {
          console.log('[DOC] 🚀 Usando OpenAI GPT-4 Vision (método preferido)...');
          return await this.openaiService.processImage(imageBuffer, mimeType);
        } catch (openaiError) {
          console.error('[DOC] ⚠️ Erro com OpenAI:', openaiError.message);
          console.error('[DOC] Tentando Gemini como fallback...');
          // Fallback para Gemini se OpenAI falhar
        }
      } else {
        console.log('[DOC] ⚠️ OpenAI não disponível - usando Gemini');
        if (!process.env.OPENAI_API_KEY) {
          console.log('[DOC] 💡 Dica: Configure OPENAI_API_KEY para melhor precisão na análise de documentos');
        }
      }

      // Usa Gemini (padrão ou fallback)
      try {
        console.log('[DOC] Chamando Gemini API...');
        console.log('[DOC] Modelo: gemini-2.0-flash-exp');
        console.log('[DOC] MIME Type:', mimeType);
        console.log('[DOC] Tamanho base64:', base64Image.length, 'bytes');
        console.log('[DOC] API Key presente:', process.env.GEMINI_API_KEY ? 'SIM' : 'NÃO');
        
        // Valida se o modelo foi inicializado corretamente
        if (!this.model) {
          throw new Error('Modelo Gemini não foi inicializado. Verifique GEMINI_API_KEY.');
        }
        
        // Adiciona timeout e retry para processamento de imagem
        const result = await retryWithBackoff(
          () => withTimeout(
            this.model.generateContent([prompt, imagePart]),
            IMAGE_PROCESSING_TIMEOUT_MS,
            'Timeout ao processar imagem com Gemini (60s)'
          ),
          2, // 2 tentativas (imagens são caras)
          2000 // delay inicial de 2s
        );
        const response = await result.response;
        const text = response.text();
        console.log('[DOC] ✅ Resposta do Gemini recebida, tamanho:', text.length, 'caracteres');
        console.log('[DOC] Primeiros 200 caracteres da resposta:', text.substring(0, 200));

        // Remove markdown code blocks se houver
        const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        try {
          const parsed = JSON.parse(jsonText);
          console.log('[DOC] ✅ JSON parseado com sucesso');
          console.log('[DOC] Tipo documento:', parsed.tipo_documento);
          console.log('[DOC] Número de transações:', parsed.transacoes?.length || 0);
          return parsed;
        } catch (parseError) {
          console.error('[DOC] ❌ Erro ao fazer parse do JSON:', parseError.message);
          console.error('[DOC] JSON recebido:', jsonText.substring(0, 500));
          throw new Error(`Erro ao processar resposta do Gemini: ${parseError.message}`);
        }
      } catch (geminiError) {
        console.error('[DOC] ❌ Erro ao chamar Gemini API:', geminiError.message);
        console.error('[DOC] Erro completo:', JSON.stringify(geminiError, null, 2));
        
        // Tratamento específico para erros conhecidos
        if (geminiError.message && geminiError.message.includes('Provided image is not valid')) {
          throw new Error('A imagem enviada não é válida. Verifique se é uma imagem JPEG, PNG, WEBP ou PDF válida.');
        }

        if (geminiError.message && geminiError.message.includes('mimeType')) {
          throw new Error(`Erro de MIME type: ${mimeType}. O arquivo pode estar corrompido ou em formato não suportado.`);
        }

        if (geminiError.message && geminiError.message.includes('PDF') || geminiError.message.includes('pdf')) {
          console.error('[DOC] ⚠️ Erro relacionado a PDF - pode ser que o modelo não suporte PDFs diretamente');
          throw new Error('Erro ao processar PDF. Tente converter para imagem (JPEG/PNG) ou enviar uma foto do documento.');
        }

        if (geminiError.message && geminiError.message.includes('size') || geminiError.message.includes('too large')) {
          throw new Error('Arquivo muito grande. Tente enviar uma imagem menor ou comprimir o PDF.');
        }

        // Re-throw com contexto adicional
        throw new Error(`Erro ao processar documento com Gemini: ${geminiError.message}`);
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
