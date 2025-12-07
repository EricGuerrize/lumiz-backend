const { GoogleGenerativeAI } = require('@google/generative-ai');
const { withTimeout, retryWithBackoff } = require('../utils/timeout');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Timeout para chamadas do Gemini (30 segundos)
const GEMINI_TIMEOUT_MS = 30000;

class GeminiService {
  constructor() {
    this.model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  }

  async processMessage(message, context = {}) {
    const hoje = new Date();
    const dataHoje = hoje.toISOString().split('T')[0];
    const diaSemanaHoje = hoje.getDay(); // 0=domingo, 1=segunda, etc.
    const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const nomeDiaHoje = diasSemana[diaSemanaHoje];

    // Calcula datas relativas para exemplos
    const ontem = new Date(hoje);
    ontem.setDate(ontem.getDate() - 1);
    const dataOntem = ontem.toISOString().split('T')[0];

    const anteontem = new Date(hoje);
    anteontem.setDate(anteontem.getDate() - 2);
    const dataAnteontem = anteontem.toISOString().split('T')[0];

    const semanaPassada = new Date(hoje);
    semanaPassada.setDate(semanaPassada.getDate() - 7);
    const dataSemanaPassada = semanaPassada.toISOString().split('T')[0];

    // Contexto histórico (se fornecido)
    let contextSection = '';
    if (context.recentMessages && context.recentMessages.length > 0) {
      contextSection = `\n\nCONTEXTO HISTÓRICO (últimas conversas do usuário):\n${context.recentMessages.map((m, i) =>
        `${i + 1}. Usuário: "${m.user_message}"\n   Bot: "${m.bot_response}"`
      ).join('\n\n')}\n\nUse este contexto para entender melhor a intenção atual.`;
    }

    // Exemplos similares (RAG) - se fornecido
    let ragSection = '';
    if (context.similarExamples && context.similarExamples.length > 0) {
      ragSection = `\n\nEXEMPLOS SIMILARES QUE FUNCIONARAM (use como referência):\n${context.similarExamples.map((ex, i) =>
        `${i + 1}. Usuário: "${ex.user_message}"\n   Intenção: ${ex.intent}\n   Resposta do bot: "${ex.bot_response.substring(0, 100)}..."`
      ).join('\n\n')}\n\nUse estes exemplos para entender melhor a intenção da mensagem atual. Se a mensagem atual for similar a algum exemplo, use a mesma intenção.`;
    }

    const prompt = `
TAREFA: Analisar mensagem e retornar JSON com intenção e dados extraídos.

CONTEXTO: Clínica de estética.
DATA DE HOJE: ${dataHoje} (${nomeDiaHoje}-feira)
${contextSection}
${ragSection}

SYSTEM INSTRUCTIONS:
- Você é a LUMIZ, uma assistente financeira para clínicas de estética e odontologia.
- PERSONA: Sofisticada, humana, prática e segura.
- TOM DE VOZ: Direto, profissional e gentil. Evite "economês" e termos técnicos (nada de DRE, competência, crédito/débito contábil).
- VOCABULÁRIO: Use "entrou", "saiu", "sobrou", "lucro", "custos", "receitas".
- FORMATAÇÃO: Use quebras de linha e emojis pontuais (✅, 💸, 📊, 💜) para clareza visual.
- REGRA DE OURO: Nunca invente dados. Se faltar info, a intenção deve refletir isso ou assumir defaults seguros.

REGRA PRINCIPAL DE CLASSIFICAÇÃO:
- Palavras que indicam VENDA (registrar_entrada): botox, preenchimento, harmonização, bioestimulador, fios, peeling, laser, paciente, cliente, procedimento, fiz um, realizei, atendi, vendi, fechei, fiz, atendimento, tox, preench
- Palavras que indicam CUSTO (registrar_saida): insumos, marketing, aluguel, energia, internet, material, produto, fornecedor, boleto, conta, paguei, gastei, comprei, pagar

MENSAGEM ATUAL: "${message}"

INTENÇÕES:
- registrar_entrada: tem palavra de VENDA (com ou sem valor)
- registrar_saida: tem palavra de CUSTO (com ou sem valor)
- consultar_saldo: saldo, resumo, lucro, quanto tenho
- consultar_historico: histórico, últimas, movimentações
- relatorio_mensal: relatório, mês, mensal
- comparar_meses: comparar, comparação, versus, vs, mês passado, mês anterior
- consultar_parcelas: parcelas, parcelado, cartão, receber, a receber
- stats_hoje: vendas hoje, faturamento hoje, quanto fiz hoje, faturamento do dia, resultado de hoje, como foi hoje, balanço de hoje
- ranking_procedimentos: qual mais vendido, procedimento mais vendido, ranking, top procedimentos, melhores procedimentos, mais atendido
- marcar_parcela_paga: recebi parcela, paguei parcela, parcela paga, recebeu parcela, baixar parcela, quitar parcela
- exportar_dados: exportar, baixar relatório, me manda pdf, excel, planilha, download, gerar relatório
- consultar_agenda: agenda, agendamentos, compromissos, consultas marcadas, ver agenda
- consultar_meta: meta, minha meta, progresso, objetivo, quanto falta, atingir meta
- insights: insights, dicas, sugestoes, sugestões, recomendacoes, recomendações
- ajuda: ajuda, como usar, exemplos, o que você faz, como funciona
- saudacao: oi, olá, bom dia, boa tarde, boa noite
- desfazer: cancelar, desfazer, apagar última, errei, deletar última
- editar_transacao: editar última, corrigir última, mudar última, alterar última
- buscar_transacao: buscar, encontrar, procurar, achar, mostrar transação
- definir_meta: minha meta é, definir meta, meta de, objetivo de, quero faturar
- enviar_documento: boleto, extrato, nota fiscal, comprovante, documento, pdf (SÓ a palavra, sem números)
- codigo_boleto: sequência longa de dígitos (44-48 números), pode ter pontos, hífens ou espaços. Ex: 84650000002-7 05870162202-7...
- apenas_valor: SÓ um número isolado (até 6 dígitos), nada mais
- apenas_procedimento: SÓ nome de procedimento/produto, sem valor
- mensagem_ambigua: não conseguiu identificar

EXTRAÇÃO:
- VALOR: números (1500, 2.800, 3mil = 3000). Se não houver valor, retorne null.
- CATEGORIA: nome do procedimento ou tipo de custo
- DESCRICAO: paciente, marca, forma de pagamento
- DATA: "${dataHoje}" por padrão. Calcule datas relativas:
  * "ontem" = subtrair 1 dia de ${dataHoje}
  * "anteontem" = subtrair 2 dias
  * "semana passada" = subtrair 7 dias
  * "segunda", "terça", etc = calcular o último dia da semana mencionado (se hoje é ${nomeDiaHoje}, calcule corretamente)
  * "dia 15" ou "15/11" = usar a data específica
- TIPO: "entrada" (venda) ou "saida" (custo)
- FORMA_PAGAMENTO: "pix", "dinheiro", "debito", "credito_avista", "parcelado" (padrão: "avista" se não especificado)
- PARCELAS: número de parcelas (se parcelado)
- BANDEIRA_CARTAO: visa, mastercard, elo, etc (se mencionado)
- NOME_CLIENTE: nome do paciente/cliente (se mencionado)

EXEMPLOS:

"Botox 2800" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":2800.00,"categoria":"Botox","forma_pagamento":"avista","data":"${dataHoje}"}}

"tox 2800" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":2800.00,"categoria":"Botox","forma_pagamento":"avista","data":"${dataHoje}"}}

"Botox 2800 paciente Maria" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":2800.00,"categoria":"Botox","descricao":"Paciente Maria","forma_pagamento":"avista","nome_cliente":"Maria","data":"${dataHoje}"}}

"Botox 2800 pix cliente Ana" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":2800.00,"categoria":"Botox","descricao":"PIX - Cliente Ana","forma_pagamento":"pix","nome_cliente":"Ana","data":"${dataHoje}"}}

"Preenchimento 1500 dinheiro Maria Silva" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":1500.00,"categoria":"Preenchimento","descricao":"Dinheiro - Maria Silva","forma_pagamento":"dinheiro","nome_cliente":"Maria Silva","data":"${dataHoje}"}}

"Harmonização 3000 débito paciente João" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":3000.00,"categoria":"Harmonização","descricao":"Débito - Paciente João","forma_pagamento":"debito","nome_cliente":"João","data":"${dataHoje}"}}

"Bioestimulador 4500 crédito à vista cliente Paula" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":4500.00,"categoria":"Bioestimulador","descricao":"Crédito à vista - Cliente Paula","forma_pagamento":"credito_avista","nome_cliente":"Paula","data":"${dataHoje}"}}

"Botox 2800 3x cartão paciente Maria" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":2800.00,"categoria":"Botox","descricao":"Paciente Maria","forma_pagamento":"parcelado","parcelas":3,"nome_cliente":"Maria","data":"${dataHoje}"}}

"Preenchimento 4500 6x visa" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":4500.00,"categoria":"Preenchimento","forma_pagamento":"parcelado","parcelas":6,"bandeira_cartao":"visa","data":"${dataHoje}"}}

"Harmonização 8000 10x mastercard cliente João" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":8000.00,"categoria":"Harmonização","descricao":"Cliente João","forma_pagamento":"parcelado","parcelas":10,"bandeira_cartao":"mastercard","nome_cliente":"João","data":"${dataHoje}"}}

"Preenchimento labial 1500 pix" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":1500.00,"categoria":"Preenchimento labial","forma_pagamento":"pix","data":"${dataHoje}"}}

"Harmonização facial 4500" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":4500.00,"categoria":"Harmonização facial","forma_pagamento":"avista","data":"${dataHoje}"}}

"Fiz um botox 2800" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":2800.00,"categoria":"Botox","forma_pagamento":"avista","data":"${dataHoje}"}}

"Realizei preenchimento 3500 cliente Ana" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":3500.00,"categoria":"Preenchimento","descricao":"Cliente Ana","forma_pagamento":"avista","nome_cliente":"Ana","data":"${dataHoje}"}}

"Atendi Maria botox 2200 pix" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":2200.00,"categoria":"Botox","descricao":"PIX - Maria","forma_pagamento":"pix","nome_cliente":"Maria","data":"${dataHoje}"}}

"Vendi harmonização 5000 3x" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":5000.00,"categoria":"Harmonização","forma_pagamento":"parcelado","parcelas":3,"data":"${dataHoje}"}}

"Fechei bioestimulador 4500 com Paula" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":4500.00,"categoria":"Bioestimulador","descricao":"Paula","forma_pagamento":"avista","nome_cliente":"Paula","data":"${dataHoje}"}}

"Atendimento preenchimento 1800" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":1800.00,"categoria":"Preenchimento","forma_pagamento":"avista","data":"${dataHoje}"}}

"Romulo botox 5000 em 3x" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":5000.00,"categoria":"Botox","forma_pagamento":"parcelado","parcelas":3,"nome_cliente":"Romulo","data":"${dataHoje}"}}

"Julia preenchimento 1200" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":1200.00,"categoria":"Preenchimento","forma_pagamento":"avista","nome_cliente":"Julia","data":"${dataHoje}"}}

"Insumos 3200" → {"intencao":"registrar_saida","dados":{"tipo":"saida","valor":3200.00,"categoria":"Insumos","data":"${dataHoje}"}}

"Marketing 800" → {"intencao":"registrar_saida","dados":{"tipo":"saida","valor":800.00,"categoria":"Marketing","data":"${dataHoje}"}}

"Aluguel 5000" → {"intencao":"registrar_saida","dados":{"tipo":"saida","valor":5000.00,"categoria":"Aluguel","data":"${dataHoje}"}}

"Botox 2800 ontem" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":2800.00,"categoria":"Botox","forma_pagamento":"avista","data":"${dataOntem}"}}

"Preenchimento 3500 semana passada cliente Ana" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":3500.00,"categoria":"Preenchimento","descricao":"Cliente Ana","forma_pagamento":"avista","nome_cliente":"Ana","data":"${dataSemanaPassada}"}}

"Insumos 1200 ontem" → {"intencao":"registrar_saida","dados":{"tipo":"saida","valor":1200.00,"categoria":"Insumos","data":"${dataOntem}"}}

"Harmonização 5000 pix anteontem paciente João" → {"intencao":"registrar_entrada","dados":{"tipo":"entrada","valor":5000.00,"categoria":"Harmonização","descricao":"PIX - Paciente João","forma_pagamento":"pix","nome_cliente":"João","data":"${dataAnteontem}"}}

"Saldo" → {"intencao":"consultar_saldo","dados":{}}
"Resumo" → {"intencao":"consultar_saldo","dados":{}}
"Histórico" → {"intencao":"consultar_historico","dados":{}}
"Relatório" → {"intencao":"relatorio_mensal","dados":{}}
"Comparar" → {"intencao":"comparar_meses","dados":{}}
"Comparar meses" → {"intencao":"comparar_meses","dados":{}}
"Como foi mês passado" → {"intencao":"comparar_meses","dados":{}}
"Evolução" → {"intencao":"comparar_meses","dados":{}}
"Parcelas" → {"intencao":"consultar_parcelas","dados":{}}
"A receber" → {"intencao":"consultar_parcelas","dados":{}}
"Cartão" → {"intencao":"consultar_parcelas","dados":{}}
"Vendas hoje" → {"intencao":"stats_hoje","dados":{}}
"Faturamento do dia" → {"intencao":"stats_hoje","dados":{}}
"Quanto fiz hoje" → {"intencao":"stats_hoje","dados":{}}
"Como foi hoje" → {"intencao":"stats_hoje","dados":{}}
"Resultado de hoje" → {"intencao":"stats_hoje","dados":{}}
"Balanço de hoje" → {"intencao":"stats_hoje","dados":{}}
"Qual mais vendido" → {"intencao":"ranking_procedimentos","dados":{}}
"Procedimento mais vendido" → {"intencao":"ranking_procedimentos","dados":{}}
"Ranking" → {"intencao":"ranking_procedimentos","dados":{}}
"Top procedimentos" → {"intencao":"ranking_procedimentos","dados":{}}
"Melhores procedimentos" → {"intencao":"ranking_procedimentos","dados":{}}
"Recebi parcela" → {"intencao":"marcar_parcela_paga","dados":{}}
"Paguei parcela" → {"intencao":"marcar_parcela_paga","dados":{}}
"Parcela paga" → {"intencao":"marcar_parcela_paga","dados":{}}
"Baixar parcela" → {"intencao":"marcar_parcela_paga","dados":{}}
"Quitar parcela" → {"intencao":"marcar_parcela_paga","dados":{}}
"Exportar" → {"intencao":"exportar_dados","dados":{}}
"Baixar relatório" → {"intencao":"exportar_dados","dados":{}}
"Me manda pdf" → {"intencao":"exportar_dados","dados":{}}
"Gerar planilha" → {"intencao":"exportar_dados","dados":{}}
"Excel" → {"intencao":"exportar_dados","dados":{}}
"Download relatório" → {"intencao":"exportar_dados","dados":{}}
"Agenda" → {"intencao":"consultar_agenda","dados":{}}
"Agendamentos" → {"intencao":"consultar_agenda","dados":{}}
"Compromissos" → {"intencao":"consultar_agenda","dados":{}}
"Consultas marcadas" → {"intencao":"consultar_agenda","dados":{}}
"Ver agenda" → {"intencao":"consultar_agenda","dados":{}}
"Meta" → {"intencao":"consultar_meta","dados":{}}
"Minha meta" → {"intencao":"consultar_meta","dados":{}}
"Progresso" → {"intencao":"consultar_meta","dados":{}}
"Objetivo" → {"intencao":"consultar_meta","dados":{}}
"Quanto falta" → {"intencao":"consultar_meta","dados":{}}
"Atingir meta" → {"intencao":"consultar_meta","dados":{}}
"Insights" → {"intencao":"insights","dados":{}}
"Me dá dicas" → {"intencao":"insights","dados":{}}
"Sugestões" → {"intencao":"insights","dados":{}}
"Ajuda" → {"intencao":"ajuda","dados":{}}
"Oi" → {"intencao":"saudacao","dados":{}}

"2800" → {"intencao":"apenas_valor","dados":{"valor":2800.00}}
"Botox" → {"intencao":"apenas_procedimento","dados":{"categoria":"Botox"}}

"boleto" → {"intencao":"enviar_documento","dados":{}}
"documento" → {"intencao":"enviar_documento","dados":{}}
"extrato" → {"intencao":"enviar_documento","dados":{}}
"nota fiscal" → {"intencao":"enviar_documento","dados":{}}

"cancelar última" → {"intencao":"desfazer","dados":{}}
"errei" → {"intencao":"desfazer","dados":{}}
"apagar última" → {"intencao":"desfazer","dados":{}}
"desfazer" → {"intencao":"desfazer","dados":{}}

"84650000002-7 05870162202-7 51105719000-7 00832414587-2" → {"intencao":"codigo_boleto","dados":{"codigo":"84650000002705870162202751105719000008324145872"}}

"23793.38128 60000.000003 00000.000408 1 84340000012345" → {"intencao":"codigo_boleto","dados":{"codigo":"23793381286000000000300000004081843400001234"}}

"84650000002705870162202751105719000008324145872" → {"intencao":"codigo_boleto","dados":{"codigo":"84650000002705870162202751105719000008324145872"}}

"o que você faz" → {"intencao":"ajuda","dados":{}}
"como funciona" → {"intencao":"ajuda","dados":{}}

RESPONDA APENAS O JSON, SEM TEXTO ADICIONAL:
`;

    try {
      // Adiciona timeout e retry para chamadas do Gemini
      const result = await retryWithBackoff(
        () => withTimeout(
          this.model.generateContent(prompt),
          GEMINI_TIMEOUT_MS,
          'Timeout ao processar mensagem com Gemini (30s)'
        ),
        3, // 3 tentativas
        1000 // delay inicial de 1s
      );

      const response = await result.response;
      const text = response.text();

      const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      return JSON.parse(jsonText);
    } catch (error) {
      console.error('[GEMINI] Erro ao processar mensagem:', error.message);
      if (error.message.includes('Timeout')) {
        console.error('[GEMINI] Timeout excedido após 30 segundos');
      }
      return {
        intencao: 'erro',
        dados: {}
      };
    }
  }
}

module.exports = new GeminiService();
