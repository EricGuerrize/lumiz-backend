const OpenAI = require('openai');
const axios = require('axios');
const { withTimeout, retryWithBackoff } = require('../utils/timeout');
require('dotenv').config();

// Timeout para processamento de imagens (60 segundos)
const IMAGE_PROCESSING_TIMEOUT_MS = 60000;

class OpenAIService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('[OPENAI] OPENAI_API_KEY não configurada. OpenAI desativado.');
      this.client = null;
      return;
    }
    
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  async processImage(imageBuffer, mimeType, fileName = null) {
    if (!this.client) {
      throw new Error('OpenAI não configurado. Configure OPENAI_API_KEY no .env');
    }

    try {
      console.log('[OPENAI] ========================================');
      console.log('[OPENAI] Processando imagem/PDF com OpenAI...');
      console.log('[OPENAI] MIME Type:', mimeType);
      console.log('[OPENAI] Tamanho:', imageBuffer.length, 'bytes');
      console.log('[OPENAI] ========================================');

      // Converte buffer para base64
      const base64Image = imageBuffer.toString('base64');
      
      // Determina o formato correto para OpenAI
      let imageFormat = 'url'; // OpenAI aceita base64 como data URL
      const dataUrl = `data:${mimeType};base64,${base64Image}`;

      const dataHoje = new Date().toISOString().split('T')[0];

      const prompt = `
TAREFA: Analisar esta imagem/PDF de documento financeiro e extrair informações.

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
- Para COMPROVANTE PIX MERCADO PAGO:
  * Procure por seções "De" (remetente) e "Para" (destinatário)
  * Assuma que quem está enviando o comprovante é quem FEZ a transferência
  * Portanto, SEMPRE será tipo "saida" e use o nome de "Para" na categoria
  * Extraia: valor, data/hora, nomes completos
- Para NOTA FISCAL: extraia fornecedor, valor total, data, número da NF
- SEMPRE extraia pelo menos uma transação se identificar o documento
- Seja assertivo: se identificar qualquer documento financeiro, extraia os dados mesmo que incompletos

RESPONDA APENAS O JSON, SEM TEXTO ADICIONAL:
`;

      console.log('[OPENAI] Chamando GPT-4 Vision API...');
      
      const response = await retryWithBackoff(
        () => withTimeout(
          this.client.chat.completions.create({
            model: 'gpt-4o', // ou 'gpt-4-turbo' para melhor suporte a PDFs
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: prompt
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: dataUrl
                    }
                  }
                ]
              }
            ],
            max_tokens: 2000,
            temperature: 0.1 // Baixa temperatura para respostas mais precisas
          }),
          IMAGE_PROCESSING_TIMEOUT_MS,
          'Timeout ao processar imagem com OpenAI (60s)'
        ),
        2, // 2 tentativas
        2000 // delay inicial de 2s
      );

      const content = response.choices[0].message.content;
      console.log('[OPENAI] ✅ Resposta recebida, tamanho:', content.length, 'caracteres');
      console.log('[OPENAI] Primeiros 200 caracteres:', content.substring(0, 200));

      // Remove markdown code blocks se houver
      const jsonText = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      try {
        const parsed = JSON.parse(jsonText);
        console.log('[OPENAI] ✅ JSON parseado com sucesso');
        console.log('[OPENAI] Tipo documento:', parsed.tipo_documento);
        console.log('[OPENAI] Número de transações:', parsed.transacoes?.length || 0);
        return parsed;
      } catch (parseError) {
        console.error('[OPENAI] ❌ Erro ao fazer parse do JSON:', parseError.message);
        console.error('[OPENAI] JSON recebido:', jsonText.substring(0, 500));
        throw new Error(`Erro ao processar resposta do OpenAI: ${parseError.message}`);
      }
    } catch (error) {
      console.error('[OPENAI] ❌ Erro ao processar imagem:', error.message);
      
      if (error.message && error.message.includes('Invalid image')) {
        throw new Error('A imagem enviada não é válida. Verifique se é uma imagem JPEG, PNG, WEBP ou PDF válida.');
      }

      if (error.message && error.message.includes('rate limit')) {
        throw new Error('Limite de requisições da OpenAI atingido. Tente novamente em alguns instantes.');
      }

      throw new Error(`Erro ao processar documento com OpenAI: ${error.message}`);
    }
  }
}

module.exports = new OpenAIService();




