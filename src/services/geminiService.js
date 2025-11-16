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
TAREFA: Analisar mensagem e retornar JSON com intenção e dados extraídos.

CONTEXTO: Clínica de estética.

REGRA PRINCIPAL DE CLASSIFICAÇÃO:
- Palavras que indicam VENDA (registrar_entrada): botox, preenchimento, harmonização, bioestimulador, fios, peeling, laser, paciente, cliente, procedimento
- Palavras que indicam CUSTO (registrar_saida): insumos, marketing, aluguel, energia, internet, material, produto, fornecedor, boleto, conta, paguei, gastei

MENSAGEM: "${message}"

INTENÇÕES:
- registrar_entrada: tem VALOR + palavra de VENDA
- registrar_saida: tem VALOR + palavra de CUSTO
- consultar_saldo: saldo, resumo, lucro, quanto tenho
- consultar_historico: histórico, últimas, movimentações
- relatorio_mensal: relatório, mês, mensal
- consultar_parcelas: parcelas, parcelado, cartão, receber, a receber
- ajuda: ajuda, como usar, exemplos
- saudacao: oi, olá, bom dia, boa tarde, boa noite
- apenas_valor: SÓ número, nada mais
- apenas_procedimento: SÓ nome de procedimento/produto, sem valor
- mensagem_ambigua: não conseguiu identificar

EXTRAÇÃO:
- VALOR: números (1500, 2.800, 3mil = 3000)
- CATEGORIA: nome do procedimento ou tipo de custo
- DESCRICAO: paciente, marca, forma de pagamento
- DATA: "${dataHoje}" (se "ontem": calcular)
- TIPO: "entrada" (venda) ou "saida" (custo)
- FORMA_PAGAMENTO: "avista" (padrão), "parcelado" (se mencionar parcelas/cartão)
- PARCELAS: número de parcelas (se parcelado)
- BANDEIRA_CARTAO: visa, mastercard, elo, etc (se mencionado)

EXEMPLOS:

"Botox 2800" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":2800.00,"categoria":"Botox","forma_pagamento":"avista","data":"${dataHoje}"}}

"Botox 2800 paciente Maria" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":2800.00,"categoria":"Botox","descricao":"Paciente Maria","forma_pagamento":"avista","data":"${dataHoje}"}}

"Botox 2800 3x cartão paciente Maria" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":2800.00,"categoria":"Botox","descricao":"Paciente Maria","forma_pagamento":"parcelado","parcelas":3,"data":"${dataHoje}"}}

"Preenchimento 4500 6x visa" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":4500.00,"categoria":"Preenchimento","forma_pagamento":"parcelado","parcelas":6,"bandeira_cartao":"visa","data":"${dataHoje}"}}

"Harmonização 8000 10x mastercard cliente João" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":8000.00,"categoria":"Harmonização","descricao":"Cliente João","forma_pagamento":"parcelado","parcelas":10,"bandeira_cartao":"mastercard","data":"${dataHoje}"}}

"Preenchimento labial 1500 pix" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":1500.00,"categoria":"Preenchimento labial","descricao":"PIX","forma_pagamento":"avista","data":"${dataHoje}"}}

"Harmonização facial 4500" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":4500.00,"categoria":"Harmonização facial","forma_pagamento":"avista","data":"${dataHoje}"}}

"Insumos 3200" → {"intencao":"registrar_saida","dados":{"tipo":"saida","valor":3200.00,"categoria":"Insumos","data":"${dataHoje}"}}

"Marketing 800" → {"intencao":"registrar_saida","dados":{"tipo":"saida","valor":800.00,"categoria":"Marketing","data":"${dataHoje}"}}

"Aluguel 5000" → {"intencao":"registrar_saida","dados":{"tipo":"saida","valor":5000.00,"categoria":"Aluguel","data":"${dataHoje}"}}

"Saldo" → {"intencao":"consultar_saldo","dados":{}}
"Resumo" → {"intencao":"consultar_saldo","dados":{}}
"Histórico" → {"intencao":"consultar_historico","dados":{}}
"Relatório" → {"intencao":"relatorio_mensal","dados":{}}
"Parcelas" → {"intencao":"consultar_parcelas","dados":{}}
"A receber" → {"intencao":"consultar_parcelas","dados":{}}
"Cartão" → {"intencao":"consultar_parcelas","dados":{}}
"Ajuda" → {"intencao":"ajuda","dados":{}}
"Oi" → {"intencao":"saudacao","dados":{}}

"2800" → {"intencao":"apenas_valor","dados":{"valor":2800.00}}
"Botox" → {"intencao":"apenas_procedimento","dados":{"categoria":"Botox"}}

RESPONDA APENAS O JSON, SEM TEXTO ADICIONAL:
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
