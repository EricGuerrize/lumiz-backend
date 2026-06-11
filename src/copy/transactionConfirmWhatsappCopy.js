/**
 * Copy WhatsApp — confirmação e correção guiada de transações.
 */

const { formatarMoeda } = require('../utils/currency');
const {
  TX_CORRECTION_FIELD_ENTRADA_FOOTER,
  TX_CORRECTION_FIELD_SAIDA_FOOTER
} = require('./whatsappMenuMarkers');

function formatDateBr(isoDate) {
  if (!isoDate) return '—';
  try {
    return new Date(`${isoDate}T12:00:00`).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch (_) {
    return String(isoDate);
  }
}

function buildCorrectionFieldPickerMessage(dados = {}) {
  const isEntrada = dados.tipo === 'entrada';
  const lines = [
    '✏️ *O que você quer corrigir?*',
    '',
    `Valor: ${formatarMoeda(dados.valor || 0)}`,
  ];

  if (isEntrada) {
    lines.push(`Procedimento: ${dados.categoria || '—'}`);
    if (dados.nome_cliente) lines.push(`Nome: ${dados.nome_cliente}`);
  } else {
    lines.push(`Categoria: ${dados.categoria || '—'}`);
    if (dados.descricao) lines.push(`Descrição: ${dados.descricao}`);
  }

  lines.push(`Data: ${formatDateBr(dados.data)}`);
  lines.push('');
  lines.push(isEntrada ? TX_CORRECTION_FIELD_ENTRADA_FOOTER : TX_CORRECTION_FIELD_SAIDA_FOOTER);

  return lines.join('\n');
}

function buildCorrectionValuePrompt(field, dados = {}) {
  const prompts = {
    valor: `Qual é o *valor* correto?\n\nAtual: ${formatarMoeda(dados.valor || 0)}\n\nExemplo: *4500* ou *R$ 4.500*`,
    procedimento: `Qual é o *procedimento* correto?\n\nAtual: ${dados.categoria || '—'}\n\nExemplo: *Preenchimento labial*`,
    categoria: `Qual é a *categoria* correta?\n\nAtual: ${dados.categoria || '—'}\n\nExemplo: *Insumos*`,
    nome: `Qual é o *nome do cliente*?\n\nAtual: ${dados.nome_cliente || '—'}\n\nExemplo: *Maria Silva*`,
    descricao: `Qual é a *descrição* correta?\n\nAtual: ${dados.descricao || '—'}\n\nExemplo: *Biogelis*`,
    data: `Qual é a *data* correta?\n\nAtual: ${formatDateBr(dados.data)}\n\nExemplo: *15/06* ou *15/06/2026*`
  };

  return (
    `${prompts[field] || 'Me manda o valor correto:'}\n\n` +
    '_Digite o novo valor ou responda *corrigir* para escolher outro campo._'
  );
}

module.exports = {
  buildCorrectionFieldPickerMessage,
  buildCorrectionValuePrompt
};
