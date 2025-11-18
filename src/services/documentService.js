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

      // Detecta o tipo MIME - verifica o header primeiro, depois os primeiros bytes
      let mimeType = imageResponse.headers['content-type'];
      console.log('[DOC] MIME type do header:', mimeType);
      
      // Se não tiver MIME type válido ou for application/octet-stream, detecta pelo conteúdo
      if (!mimeType || mimeType === 'application/octet-stream' || !mimeType.startsWith('image/')) {
        console.log('[DOC] MIME type inválido, detectando pelo conteúdo...');
        // Detecta pelo magic number (primeiros bytes)
        const firstBytes = imageBuffer.slice(0, 4);
        const hex = Array.from(firstBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
        console.log('[DOC] Primeiros bytes (hex):', hex);
        
        if (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8) {
          mimeType = 'image/jpeg';
        } else if (firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4E && firstBytes[3] === 0x47) {
          mimeType = 'image/png';
        } else if (firstBytes[0] === 0x47 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46) {
          mimeType = 'image/gif';
        } else if (firstBytes[0] === 0x52 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x46) {
          mimeType = 'image/webp';
        } else {
          // Fallback para JPEG (mais comum)
          mimeType = 'image/jpeg';
          console.log('[DOC] Tipo não identificado, usando JPEG como fallback');
        }
        
        console.log('[DOC] MIME type detectado pelo conteúdo:', mimeType);
      }
      
      // Validação final - nunca enviar application/octet-stream
      if (mimeType === 'application/octet-stream' || !mimeType.startsWith('image/')) {
        console.warn('[DOC] MIME type ainda inválido após detecção, forçando JPEG');
        mimeType = 'image/jpeg';
      }
      
      console.log('[DOC] MIME type final usado:', mimeType);

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

      // Validação final antes de enviar - garante que nunca será application/octet-stream
      if (!mimeType || mimeType === 'application/octet-stream' || !mimeType.startsWith('image/')) {
        console.error('[DOC] ERRO CRÍTICO: mimeType inválido antes de enviar:', mimeType);
        mimeType = 'image/jpeg'; // Força JPEG como último recurso
        console.log('[DOC] MIME type corrigido para:', mimeType);
      }

      console.log('[DOC] Enviando para Gemini com mimeType:', mimeType);

      const imagePart = {
        inlineData: {
          data: base64Image,
          mimeType: mimeType
        }
      };

      const result = await this.model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();

      // Remove markdown code blocks se houver
      const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      return JSON.parse(jsonText);
    } catch (error) {
      console.error('[DOC] Erro ao processar imagem:', error);
      return {
        tipo_documento: 'erro',
        transacoes: [],
        erro: error.message
      };
    }
  }

  formatDocumentSummary(result) {
    if (result.tipo_documento === 'erro') {
      return `Erro ao analisar documento 😢\n\nTente enviar novamente ou registre manualmente.`;
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
