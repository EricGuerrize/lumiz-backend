const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

class GeminiService {
  constructor() {
    this.model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  }

  async processMessage(message) {
    const prompt = `
Você é um assistente financeiro inteligente. Analise a mensagem do usuário e identifique a INTENÇÃO e extraia os DADOS.

INTENÇÕES POSSÍVEIS:
- registrar_entrada: usuário quer registrar uma receita/ganho
- registrar_saida: usuário quer registrar uma despesa/gasto
- consultar_saldo: usuário quer ver o saldo total
- consultar_historico: usuário quer ver transações passadas
- relatorio_mensal: usuário quer um resumo do mês
- ajuda: usuário não sabe o que fazer
- saudacao: usuário está cumprimentando

MENSAGEM DO USUÁRIO:
"${message}"

RESPONDA SEMPRE EM JSON com este formato:
{
  "intencao": "nome_da_intencao",
  "dados": {
    "tipo": "entrada ou saida (se aplicável)",
    "valor": 0.00,
    "categoria": "nome da categoria (se mencionada)",
    "descricao": "descrição opcional",
    "data": "YYYY-MM-DD (use hoje se não especificado)"
  }
}

EXEMPLOS:
"gastei 50 reais no mercado" → {"intencao":"registrar_saida","dados":{"tipo":"saida","valor":50.00,"categoria":"mercado","data":"2025-11-14"}}
"recebi 1500 do salário" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":1500.00,"categoria":"salário","data":"2025-11-14"}}
"qual meu saldo?" → {"intencao":"consultar_saldo","dados":{}}
"olá" → {"intencao":"saudacao","dados":{}}
`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      return JSON.parse(jsonText);
    } catch (error) {
      console.error('Erro no Gemini:', error);
      return {
        intencao: 'erro',
        dados: {}
      };
    }
  }
}

module.exports = new GeminiService();
