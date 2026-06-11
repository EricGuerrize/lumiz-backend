/**
 * Mensagens WhatsApp — cadastro básico de paciente (item #36).
 * Nunca hardcodar strings de mensagem em service/controller; toda copy vive aqui.
 */

function _fmtTelefone(tel) {
  if (!tel) return null;
  const d = String(tel).replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel;
}

function _fmtData(data) {
  if (!data) return null;
  const m = String(data).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return data;
}

/** Bloco de dados do paciente (reutilizado em consulta e confirmação). */
function _blocoDados(p = {}) {
  const linhas = [`*${p.nome}*`];
  const tel = _fmtTelefone(p.telefone);
  if (tel) linhas.push(`📞 ${tel}`);
  if (p.email) linhas.push(`✉️ ${p.email}`);
  if (p.cpf) linhas.push(`🪪 CPF: ${p.cpf}`);
  const nasc = _fmtData(p.data_nascimento);
  if (nasc) linhas.push(`🎂 ${nasc}`);
  if (p.observacoes) linhas.push(`📝 ${p.observacoes}`);
  return linhas.join('\n');
}

function precisaNome() {
  return (
    'Pra cadastrar o paciente preciso pelo menos do *nome* 🙂\n\n' +
    'Exemplo:\n_"cadastrar paciente Maria Silva, telefone 11999998888"_'
  );
}

function pacienteCadastrado(p) {
  return `✅ Paciente cadastrado!\n\n${_blocoDados(p)}`;
}

/** Paciente com mesmo nome já existe → pergunta se quer atualizar. */
function pacienteJaExiste(existente) {
  return (
    `Já tenho um paciente chamado *${existente.nome}* cadastrado 👇\n\n` +
    `${_blocoDados(existente)}\n\n` +
    'Quer *atualizar* os dados dele com o que você mandou?\n' +
    '1️⃣ Sim, atualizar\n' +
    '2️⃣ Não, deixar como está'
  );
}

function pacienteAtualizado(p) {
  return `✅ Dados atualizados!\n\n${_blocoDados(p)}`;
}

function atualizacaoCancelada() {
  return 'Ok, mantive o cadastro como estava 👍';
}

/** Consulta de um paciente — dados + resumo de histórico (se houver). */
function dadosPaciente(p, resumo = null) {
  let texto = `👤 *Paciente*\n\n${_blocoDados(p)}`;
  if (resumo && resumo.total_atendimentos > 0) {
    const valor = (resumo.valor_total || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
    texto +=
      `\n\n📊 *Histórico*\n` +
      `Atendimentos: ${resumo.total_atendimentos}\n` +
      `Total movimentado: ${valor}`;
  } else {
    texto += '\n\n_Sem atendimentos registrados ainda._';
  }
  return texto;
}

function pacienteNaoEncontrado(termo) {
  const t = termo ? ` *${termo}*` : '';
  return (
    `Não encontrei paciente${t} no seu cadastro 🤔\n\n` +
    'Você pode cadastrar com:\n_"cadastrar paciente Maria Silva, telefone 11999998888"_'
  );
}

function listaPacientes(pacientes = []) {
  if (!pacientes.length) {
    return (
      'Você ainda não tem pacientes cadastrados 📋\n\n' +
      'Cadastre o primeiro com:\n_"cadastrar paciente Maria Silva, telefone 11999998888"_'
    );
  }
  const linhas = pacientes.map((p) => {
    const tel = _fmtTelefone(p.telefone);
    return tel ? `• *${p.nome}* — ${tel}` : `• *${p.nome}*`;
  });
  const cabecalho =
    pacientes.length === 1
      ? '👥 *Seu paciente*'
      : `👥 *Seus pacientes* (${pacientes.length})`;
  return `${cabecalho}\n\n${linhas.join('\n')}`;
}

module.exports = {
  precisaNome,
  pacienteCadastrado,
  pacienteJaExiste,
  pacienteAtualizado,
  atualizacaoCancelada,
  dadosPaciente,
  pacienteNaoEncontrado,
  listaPacientes,
};
