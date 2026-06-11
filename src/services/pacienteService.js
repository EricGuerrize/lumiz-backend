/**
 * Serviço de cadastro básico de paciente (item #36).
 *
 * Responsabilidade: cadastrar/atualizar, consultar e listar pacientes (tabela
 * `clientes`) a partir de mensagens do WhatsApp. Inclui um parser puro
 * (`parsePacienteFields`) que extrai nome (obrigatório) + campos opcionais
 * (telefone, cpf, data de nascimento, email) de texto livre.
 *
 * Camada: service. Consome apenas `src/db/supabase`. Nunca envia WhatsApp
 * diretamente (isso é responsabilidade do handler/outboundMessageService).
 */

const supabase = require('../db/supabase');

// Palavras de comando que precedem o nome e devem ser removidas dele.
const COMMAND_PREFIX_RE =
  /^(?:cadastra(?:r)?|registra(?:r)?|nov[oa]|adiciona(?:r)?|criar?)?\s*(?:paciente|cliente)\s*/i;

// Rótulos opcionais reconhecidos no texto livre.
const LABELS = {
  telefone: /(?:telefone|tel|fone|whats(?:app)?|celular|cel)\.?\s*:?\s*/i,
  email: /(?:e-?mail)\.?\s*:?\s*/i,
  cpf: /cpf\.?\s*:?\s*/i,
  data_nascimento:
    /(?:data\s+de\s+nascimento|nascimento|nasc|anivers[aá]rio|dn)\.?\s*:?\s*/i,
};

function _onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function _capitalizeName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) =>
      w.length <= 2 && /^(de|da|do|e|dos|das)$/i.test(w)
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join(' ');
}

function _normalizeDataNascimento(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // dd/mm/aaaa ou dd-mm-aaaa
  const br = s.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (br) {
    let [, d, m, y] = br;
    if (y.length === 2) y = `20${y}`;
    const dd = d.padStart(2, '0');
    const mm = m.padStart(2, '0');
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
      return `${y}-${mm}-${dd}`;
    }
  }
  // aaaa-mm-dd
  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  return null;
}

/**
 * Parser puro de campos de paciente a partir de texto livre.
 * @param {string} message - Texto enviado pela secretária.
 * @returns {{nome: string|null, telefone: string|null, cpf: string|null, data_nascimento: string|null, email: string|null}}
 */
function parsePacienteFields(message) {
  const out = {
    nome: null,
    telefone: null,
    cpf: null,
    data_nascimento: null,
    email: null,
  };
  const raw = String(message || '').trim();
  if (!raw) return out;

  // Email (extrai e remove do texto base).
  const emailMatch = raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (emailMatch) out.email = emailMatch[0].toLowerCase();

  // Data de nascimento (com ou sem rótulo).
  out.data_nascimento = _normalizeDataNascimento(raw);

  // CPF: 11 dígitos (formatado ou não), só aceita se houver rótulo OU 11 dígitos seguidos.
  const cpfLabeled = raw.match(
    new RegExp(LABELS.cpf.source + '([\\d.\\-\\s]{11,18})', 'i')
  );
  if (cpfLabeled) {
    const digits = _onlyDigits(cpfLabeled[1]);
    if (digits.length === 11) out.cpf = digits;
  } else {
    const cpfBare = raw.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
    if (cpfBare) {
      const digits = _onlyDigits(cpfBare[0]);
      if (digits.length === 11) out.cpf = digits;
    }
  }

  // Telefone: com rótulo, ou sequência de 10-11 dígitos que não seja o CPF.
  const telLabeled = raw.match(
    new RegExp(LABELS.telefone.source + '([\\d()\\-\\s+]{8,20})', 'i')
  );
  if (telLabeled) {
    const digits = _onlyDigits(telLabeled[1]);
    if (digits.length >= 8 && digits.length <= 13) out.telefone = digits;
  }
  if (!out.telefone) {
    const candidates = raw.match(/\+?\d[\d()\-\s]{7,18}\d/g) || [];
    for (const c of candidates) {
      const digits = _onlyDigits(c);
      if (digits === out.cpf) continue;
      if (digits.length === 10 || digits.length === 11) {
        out.telefone = digits;
        break;
      }
    }
  }

  // Nome: parte antes do primeiro separador relevante (vírgula ou rótulo),
  // descontando o prefixo de comando e qualquer trecho já consumido.
  let nomePart = raw.split(/[,;]/)[0];
  // Corta no primeiro rótulo conhecido, caso não haja vírgula.
  for (const labelRe of Object.values(LABELS)) {
    nomePart = nomePart.replace(new RegExp(labelRe.source + '.*$', 'i'), '');
  }
  if (emailMatch) nomePart = nomePart.replace(emailMatch[0], '');
  nomePart = nomePart.replace(COMMAND_PREFIX_RE, '');
  // Remove números soltos remanescentes (telefone/cpf/data sem rótulo).
  nomePart = nomePart.replace(/[\d().+\-/]{4,}/g, ' ');
  nomePart = nomePart.replace(/\s+/g, ' ').trim();

  if (nomePart && /[a-zA-ZÀ-ÿ]{2,}/.test(nomePart)) {
    out.nome = _capitalizeName(nomePart);
  }

  return out;
}

/** Remove chaves com valor null/undefined de um objeto (para updates parciais). */
function _compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

class PacienteService {
  /**
   * Busca um paciente por nome (case-insensitive, match exato e depois parcial).
   * @param {string} userId
   * @param {string} nome
   * @returns {Promise<object|null>}
   */
  async findByNome(userId, nome) {
    const termo = String(nome || '').trim();
    if (!userId || !termo) return null;

    const { data: exact } = await supabase
      .from('clientes')
      .select('*')
      .eq('user_id', userId)
      .ilike('nome', termo)
      .limit(1)
      .maybeSingle();
    if (exact) return exact;

    const { data: partial } = await supabase
      .from('clientes')
      .select('*')
      .eq('user_id', userId)
      .ilike('nome', `%${termo}%`)
      .order('nome', { ascending: true })
      .limit(1)
      .maybeSingle();
    return partial || null;
  }

  /**
   * Lista pacientes do usuário (campos curtos para exibição).
   * @param {string} userId
   * @param {number} [limit=50]
   * @returns {Promise<Array<{id, nome, telefone}>>}
   */
  async listar(userId, limit = 50) {
    if (!userId) return [];
    const { data, error } = await supabase
      .from('clientes')
      .select('id, nome, telefone')
      .eq('user_id', userId)
      .order('nome', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  /**
   * Cria um paciente. Não sobrescreve existente: o caller deve checar antes.
   * @param {string} userId
   * @param {object} campos - { nome, telefone?, cpf?, data_nascimento?, email?, observacoes? }
   * @returns {Promise<object>}
   */
  async criar(userId, campos = {}) {
    const nome = String(campos.nome || '').trim();
    if (!userId || !nome) throw new Error('userId e nome são obrigatórios');

    const record = _compact({
      user_id: userId,
      nome,
      telefone: campos.telefone || null,
      cpf: campos.cpf || null,
      data_nascimento: campos.data_nascimento || null,
      email: campos.email || null,
      observacoes: campos.observacoes || null,
    });

    const { data, error } = await supabase
      .from('clientes')
      .insert([record])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Atualiza um paciente existente (merge parcial — só campos não-nulos).
   * @param {string} userId
   * @param {string} clienteId
   * @param {object} campos
   * @returns {Promise<object>}
   */
  async atualizar(userId, clienteId, campos = {}) {
    const patch = _compact({
      telefone: campos.telefone,
      cpf: campos.cpf,
      data_nascimento: campos.data_nascimento,
      email: campos.email,
      observacoes: campos.observacoes,
    });
    if (!Object.keys(patch).length) {
      const { data } = await supabase
        .from('clientes')
        .select('*')
        .eq('user_id', userId)
        .eq('id', clienteId)
        .maybeSingle();
      return data;
    }

    const { data, error } = await supabase
      .from('clientes')
      .update(patch)
      .eq('user_id', userId)
      .eq('id', clienteId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Resumo leve de histórico de atendimentos de um paciente.
   * Reaproveita a tabela `atendimentos` (cliente_id, valor_total).
   * @param {string} userId
   * @param {string} clienteId
   * @returns {Promise<{total_atendimentos: number, valor_total: number}>}
   */
  async getResumoHistorico(userId, clienteId) {
    const vazio = { total_atendimentos: 0, valor_total: 0 };
    if (!userId || !clienteId) return vazio;
    try {
      const { data, error } = await supabase
        .from('atendimentos')
        .select('valor_total')
        .eq('user_id', userId)
        .eq('cliente_id', clienteId);
      if (error) return vazio;
      const rows = data || [];
      const valor_total = rows.reduce(
        (acc, r) => acc + (parseFloat(r.valor_total) || 0),
        0
      );
      return { total_atendimentos: rows.length, valor_total };
    } catch (_e) {
      return vazio;
    }
  }
}

const instance = new PacienteService();
instance.parsePacienteFields = parsePacienteFields;
module.exports = instance;
module.exports.parsePacienteFields = parsePacienteFields;
