const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

class GeminiService {
  constructor() {
    this.model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  }

  async processMessage(message) {
    const dataHoje = new Date().toISOString().split('T')[0];

    const prompt = `
Você é a Lumiz, assistente financeira inteligente para clínicas de estética.
Analise a mensagem do usuário e identifique a INTENÇÃO e extraia os DADOS com precisão.

CONTEXTO: Clínicas de estética trabalham com:
- Receitas (vendas): procedimentos estéticos (botox, preenchimento, harmonização, etc)
- Custos (despesas): insumos, produtos, boletos, marketing, aluguel, etc

INTENÇÕES POSSÍVEIS:
- registrar_entrada: registrar uma venda/receita de procedimento
- registrar_saida: registrar um custo/despesa
- consultar_saldo: ver resumo financeiro, lucro, margem
- consultar_historico: ver vendas/movimentações recentes
- relatorio_mensal: resumo detalhado do mês
- ajuda: dúvidas sobre como usar
- saudacao: cumprimento inicial (oi, olá, bom dia)
- apenas_valor: usuário mandou só um número sem contexto
- apenas_procedimento: usuário mandou só nome de procedimento/produto sem valor
- mensagem_ambigua: não conseguiu identificar claramente a intenção

MENSAGEM DO USUÁRIO:
"${message}"

REGRAS DE EXTRAÇÃO:
1. VALOR: extraia números como valor (ex: "1500", "R$ 2.800", "3mil200")
2. CATEGORIA: identifique procedimentos (botox, preenchimento, lipo, etc) ou custos (insumos, marketing, etc)
3. DESCRIÇÃO: paciente, marca de produto, ou contexto adicional
4. DATA: use "${dataHoje}" se não especificado. Se "ontem", calcule corretamente.
5. TIPO: "entrada" para vendas/receitas, "saida" para custos/despesas

RESPONDA SEMPRE EM JSON VÁLIDO:
{
  "intencao": "nome_da_intencao",
  "dados": {
    "tipo": "entrada ou saida",
    "valor": 0.00,
    "categoria": "nome da categoria",
    "descricao": "descrição opcional",
    "data": "YYYY-MM-DD"
  }
}

EXEMPLOS PARA CLÍNICAS DE ESTÉTICA:
"Paciente Ana, preenchimento labial, R$ 1.500 no PIX" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":1500.00,"categoria":"Preenchimento labial","descricao":"Paciente Ana - PIX","data":"${dataHoje}"}}

"Registra venda de botox facial, R$ 2.800, cartão 4x" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":2800.00,"categoria":"Botox facial","descricao":"Cartão 4x","data":"${dataHoje}"}}

"Paguei o boleto de R$ 3.200 dos insumos Allergan" → {"intencao":"registrar_saida","dados":{"tipo":"saida","valor":3200.00,"categoria":"Insumos","descricao":"Allergan - Boleto","data":"${dataHoje}"}}

"Custo de marketing, R$ 800" → {"intencao":"registrar_saida","dados":{"tipo":"saida","valor":800.00,"categoria":"Marketing","data":"${dataHoje}"}}

"Qual meu lucro do mês?" → {"intencao":"consultar_saldo","dados":{}}

"Me mostra o resumo financeiro" → {"intencao":"relatorio_mensal","dados":{}}

"Últimas vendas" → {"intencao":"consultar_historico","dados":{}}

"Oi" → {"intencao":"saudacao","dados":{}}

CASOS DE ERRO/AMBIGUIDADE:
"1500" → {"intencao":"apenas_valor","dados":{"valor":1500.00}}

"Botox" → {"intencao":"apenas_procedimento","dados":{"categoria":"Botox"}}

"preenchimento" → {"intencao":"apenas_procedimento","dados":{"categoria":"Preenchimento"}}

"xyz abc" → {"intencao":"mensagem_ambigua","dados":{}}
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
