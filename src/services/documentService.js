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

      // Detecta o tipo MIME
      const mimeType = imageResponse.headers['content-type'] || 'image/jpeg';

      const dataHoje = new Date().toISOString().split('T')[0];

      const prompt = `
TAREFA: Analisar esta imagem de documento financeiro e extrair informações.

TIPOS DE DOCUMENTO:
1. BOLETO: código de barras, valor, vencimento, beneficiário
2. EXTRATO BANCÁRIO: lista de transações com datas e valores
3. COMPROVANTE DE PAGAMENTO: valor pago, data, destinatário
4. NOTA FISCAL: valor total, fornecedor, data, itens
5. FATURA DE CARTÃO: valor total, parcelas, data vencimento
6. RECIBO: valor, serviço prestado, data

EXTRAÇÃO:
- tipo_documento: tipo identificado
- transacoes: array de transações encontradas, cada uma com:
  - tipo: "entrada" ou "saida"
  - valor: número
  - categoria: nome/descrição
  - data: data da transação (formato YYYY-MM-DD)
  - descricao: detalhes adicionais

REGRAS:
- Para BOLETO/NOTA FISCAL/FATURA: geralmente é SAÍDA (custo)
- Para EXTRATO: analise cada linha (crédito=entrada, débito=saída)
- Para COMPROVANTE: pode ser entrada ou saída dependendo do contexto
- Se não conseguir identificar, retorne tipo_documento: "nao_identificado"

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

Não identificado:
{
  "tipo_documento": "nao_identificado",
  "transacoes": []
}

RESPONDA APENAS O JSON, SEM TEXTO ADICIONAL:
`;

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
