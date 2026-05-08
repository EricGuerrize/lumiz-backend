// Fase 19 — LGPD: portabilidade (export) + esquecimento (delete).
//
// Direitos cobertos:
//  - Art. 18, II — acesso aos dados.
//  - Art. 18, V — portabilidade dos dados a outro fornecedor.
//  - Art. 18, VI — eliminação dos dados pessoais tratados com consentimento.
//
// Estratégia de exclusão:
//  - Confirmação dupla por email (token TTL 24h em account_deletion_tokens).
//  - Anonimização do audit_log (preserva trilha operacional sem PII).
//  - Soft-delete de profiles (is_active=false, deactivated_at, PII zeradas).
//  - Cascade delete via FK para o resto (atendimentos, contas_pagar, etc.).
//  - Cancelamento de subscription ativa.
//  - Auth user (Supabase Auth) NÃO é deletado aqui — operação manual do operador,
//    para evitar ciclos e permitir auditoria interna.
//
// O service nunca lança erros não esperados ao chamador: degrada com log e
// retorna estrutura indicando o que foi/não foi processado.

const supabase = require('../db/supabase');

const TOKEN_TTL_HOURS = 24;

// Tabelas com user_id direto que entram no export.
// Views (view_*) ficam de fora (são derivadas).
const EXPORT_TABLES = Object.freeze([
  'profiles',
  'agendamentos',
  'alter_antecipacoes',
  'alter_cobertura_snapshots',
  'alter_recebiveis',
  'analytics_events',
  'atendimentos',
  'audit_log',
  'beta_feedback',
  'clientes',
  'colaboradores',
  'comissoes',
  'contas_pagar',
  'conversation_history',
  'emergency_alert_history',
  'feature_flags',
  'fornecedores',
  'mdr_configs',
  'monthly_goals',
  'movimentacoes_estoque',
  'nf_validade_itens',
  'ocr_jobs',
  'onboarding_progress',
  'orcamentos',
  'procedimentos',
  'reminders_sent',
  'supplier_documents',
  'user_insights',
  'user_roles',
]);

// Tabelas que cascateiam por outras (não têm user_id direto). Inclusas no
// export via JOIN para garantir portabilidade completa.
//
//  parcelas → atendimentos.user_id
const RELATIONAL_TABLES = Object.freeze({
  parcelas: { parentTable: 'atendimentos', parentFk: 'atendimento_id' },
});

function _normalizeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

async function _safeSelectByUserId(table, userId) {
  try {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', userId);
    if (error) {
      console.warn(`[LGPD] Falha ao ler ${table}: ${error.message}`);
      return [];
    }
    return _normalizeRows(data);
  } catch (err) {
    console.warn(`[LGPD] Exceção ao ler ${table}: ${err.message}`);
    return [];
  }
}

async function _safeSelectProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.warn(`[LGPD] Falha ao ler profile: ${error.message}`);
      return null;
    }
    return data || null;
  } catch (err) {
    console.warn(`[LGPD] Exceção ao ler profile: ${err.message}`);
    return null;
  }
}

async function _safeSelectRelational(table, parentTable, parentFk, userId) {
  try {
    const { data: parents, error: parentErr } = await supabase
      .from(parentTable)
      .select('id')
      .eq('user_id', userId);
    if (parentErr) {
      console.warn(`[LGPD] Falha pai (${parentTable}) para ${table}: ${parentErr.message}`);
      return [];
    }
    const parentIds = _normalizeRows(parents).map(p => p.id).filter(Boolean);
    if (parentIds.length === 0) return [];

    const { data, error } = await supabase
      .from(table)
      .select('*')
      .in(parentFk, parentIds);
    if (error) {
      console.warn(`[LGPD] Falha ao ler ${table} via ${parentFk}: ${error.message}`);
      return [];
    }
    return _normalizeRows(data);
  } catch (err) {
    console.warn(`[LGPD] Exceção ao ler relacional ${table}: ${err.message}`);
    return [];
  }
}

/**
 * Coleta todos os dados pessoais e operacionais do usuário em um objeto
 * estruturado por tabela. Cada tabela vira uma chave; tabelas vazias são
 * incluídas (com array []) para deixar explícito o que foi inspecionado.
 */
async function collectUserData(userId) {
  if (!userId) throw new Error('userId é obrigatório');

  const result = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    user_id: userId,
    tables: {},
  };

  const profile = await _safeSelectProfile(userId);
  result.tables.profiles = profile ? [profile] : [];

  const directTables = EXPORT_TABLES.filter(t => t !== 'profiles');
  const directResults = await Promise.all(
    directTables.map(async t => [t, await _safeSelectByUserId(t, userId)])
  );
  for (const [table, rows] of directResults) {
    result.tables[table] = rows;
  }

  for (const [table, rel] of Object.entries(RELATIONAL_TABLES)) {
    result.tables[table] = await _safeSelectRelational(
      table,
      rel.parentTable,
      rel.parentFk,
      userId,
    );
  }

  result.summary = Object.fromEntries(
    Object.entries(result.tables).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
  );

  return result;
}

/**
 * Anonimiza o histórico de auditoria do usuário: zera user_id, IP e user-agent,
 * mas mantém action / entity_type para preservar valor estatístico/operacional.
 *
 * Retorna { rowsAffected }.
 */
async function anonymizeAuditLog(userId) {
  if (!userId) throw new Error('userId é obrigatório');
  try {
    const { data, error } = await supabase
      .from('audit_log')
      .update({ user_id: null, ip_address: null, user_agent: null })
      .eq('user_id', userId)
      .select('id');
    if (error) {
      console.warn(`[LGPD] Falha ao anonimizar audit_log: ${error.message}`);
      return { rowsAffected: 0, error: error.message };
    }
    return { rowsAffected: _normalizeRows(data).length };
  } catch (err) {
    console.warn(`[LGPD] Exceção ao anonimizar audit_log: ${err.message}`);
    return { rowsAffected: 0, error: err.message };
  }
}

/**
 * Soft-delete do profile: marca inativo + zera PII.
 * Email vai para um placeholder único pra não conflitar com índices unique e
 * pra deixar claro que a conta foi excluída.
 */
async function softDeleteProfile(userId) {
  if (!userId) throw new Error('userId é obrigatório');
  const placeholderEmail = `deleted-${userId}@lumiz.deleted`;
  const placeholderPhone = `+0deleted${userId.replace(/-/g, '').slice(0, 12)}`;
  try {
    const { error } = await supabase
      .from('profiles')
      .update({
        is_active: false,
        deactivated_at: new Date().toISOString(),
        nome_completo: '[Conta excluída]',
        nome_clinica: '[Conta excluída]',
        telefone: placeholderPhone,
        whatsapp_contato: null,
        email: placeholderEmail,
        cidade: null,
        responsavel_info: null,
      })
      .eq('id', userId);
    if (error) {
      console.warn(`[LGPD] Falha ao soft-delete profile: ${error.message}`);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    console.warn(`[LGPD] Exceção ao soft-delete profile: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function cancelSubscription(userId) {
  if (!userId) return { ok: false, error: 'userId obrigatório' };
  try {
    // Hoje a tabela subscriptions é chaveada por clinic_id, mas no modelo
    // single-tenant atual clinic_id === userId. Quando multi-tenant entrar
    // (Fase 14), trocar para o clinic_id real do usuário.
    const { data, error } = await supabase
      .from('subscriptions')
      .update({ status: 'cancelled' })
      .eq('clinic_id', userId)
      .select('id');
    if (error) {
      console.warn(`[LGPD] Falha ao cancelar subscription: ${error.message}`);
      return { ok: false, error: error.message };
    }
    return { ok: true, rowsAffected: _normalizeRows(data).length };
  } catch (err) {
    console.warn(`[LGPD] Exceção ao cancelar subscription: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Limpa dados operacionais antes do soft-delete do profile.
 *
 * Preferimos delete explícito por tabela em vez de depender 100% do CASCADE
 * para:
 *  - garantir que dados sumam mesmo onde a FK não tem ON DELETE CASCADE;
 *  - poder reportar quantas linhas foram apagadas por tabela.
 *
 * Atendimentos e contas_pagar são deletados — nada de manter "dados fiscais
 * por 5 anos anonimizados" no MVP. O export entregue ao usuário cumpre o
 * direito à portabilidade; obrigações fiscais ficam no contábil dele.
 */
const TABLES_TO_PURGE = Object.freeze(EXPORT_TABLES.filter(t => t !== 'profiles' && t !== 'audit_log'));

async function purgeOperationalData(userId) {
  if (!userId) throw new Error('userId é obrigatório');
  const perTable = {};
  for (const table of TABLES_TO_PURGE) {
    try {
      const { data, error } = await supabase
        .from(table)
        .delete()
        .eq('user_id', userId)
        .select('id');
      if (error) {
        console.warn(`[LGPD] Falha ao purgar ${table}: ${error.message}`);
        perTable[table] = { rowsAffected: 0, error: error.message };
        continue;
      }
      perTable[table] = { rowsAffected: _normalizeRows(data).length };
    } catch (err) {
      console.warn(`[LGPD] Exceção ao purgar ${table}: ${err.message}`);
      perTable[table] = { rowsAffected: 0, error: err.message };
    }
  }
  return perTable;
}

function _ttlIso(hours = TOKEN_TTL_HOURS) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

function _extractContext(req) {
  if (!req) return { ip: null, userAgent: null };
  const ip = req.ip || req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || null;
  const userAgent = req.headers?.['user-agent'] || null;
  return { ip, userAgent };
}

/**
 * Cria token de exclusão (uuid, TTL 24h) e devolve o registro para que o caller
 * (controller/route) envie por email ao usuário. Aborta se já existir token
 * ativo recente — evita criação em massa por bot.
 */
async function requestDeletionToken(userId, req) {
  if (!userId) throw new Error('userId é obrigatório');

  const { ip, userAgent } = _extractContext(req);

  // Reaproveita token ativo recente (último 1h) para evitar spam de emails.
  try {
    const { data: existing } = await supabase
      .from('account_deletion_tokens')
      .select('id, token, expira_em, created_at')
      .eq('user_id', userId)
      .is('usado_em', null)
      .gt('expira_em', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    if (Array.isArray(existing) && existing[0]) {
      const minutesOld = (Date.now() - new Date(existing[0].created_at).getTime()) / 60000;
      if (minutesOld < 60) {
        return { token: existing[0].token, expira_em: existing[0].expira_em, reused: true };
      }
    }
  } catch (err) {
    console.warn(`[LGPD] Falha ao consultar tokens existentes: ${err.message}`);
  }

  const expira_em = _ttlIso();
  try {
    const { data, error } = await supabase
      .from('account_deletion_tokens')
      .insert({
        user_id: userId,
        expira_em,
        requested_ip: ip,
        requested_user_agent: userAgent,
      })
      .select('id, token, expira_em')
      .single();
    if (error) throw error;
    return { token: data.token, expira_em: data.expira_em, reused: false };
  } catch (err) {
    console.error(`[LGPD] Falha ao criar token de deleção: ${err.message}`);
    throw err;
  }
}

/**
 * Valida e consome o token. Retorna { userId } se válido. Lança Error com
 * mensagem human-readable em PT-BR se inválido (rota mapeia para 400/410).
 */
async function consumeDeletionToken(token) {
  if (!token) {
    const err = new Error('Token de confirmação obrigatório.');
    err.code = 'TOKEN_MISSING';
    throw err;
  }
  try {
    const { data, error } = await supabase
      .from('account_deletion_tokens')
      .select('id, user_id, expira_em, usado_em')
      .eq('token', token)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const err = new Error('Token inválido ou já utilizado.');
      err.code = 'TOKEN_INVALID';
      throw err;
    }
    if (data.usado_em) {
      const err = new Error('Token já utilizado.');
      err.code = 'TOKEN_USED';
      throw err;
    }
    if (new Date(data.expira_em).getTime() < Date.now()) {
      const err = new Error('Token expirado. Solicite a exclusão novamente.');
      err.code = 'TOKEN_EXPIRED';
      throw err;
    }

    const { error: markErr } = await supabase
      .from('account_deletion_tokens')
      .update({ usado_em: new Date().toISOString() })
      .eq('id', data.id);
    if (markErr) {
      console.warn(`[LGPD] Falha ao marcar token como usado: ${markErr.message}`);
    }

    return { userId: data.user_id };
  } catch (err) {
    if (err.code) throw err;
    console.error(`[LGPD] Falha ao consumir token: ${err.message}`);
    const wrapped = new Error('Falha ao processar token. Tente novamente.');
    wrapped.code = 'TOKEN_LOOKUP_ERROR';
    throw wrapped;
  }
}

/**
 * Pipeline completo de exclusão. Chamado após consumeDeletionToken validar
 * o token. Devolve relatório do que foi feito.
 */
async function executeDeletion(userId) {
  if (!userId) throw new Error('userId é obrigatório');

  const report = {
    user_id: userId,
    started_at: new Date().toISOString(),
    steps: {},
  };

  report.steps.subscription = await cancelSubscription(userId);
  report.steps.audit_log = await anonymizeAuditLog(userId);
  report.steps.purge = await purgeOperationalData(userId);
  report.steps.profile = await softDeleteProfile(userId);

  report.finished_at = new Date().toISOString();
  return report;
}

module.exports = {
  // Constantes
  EXPORT_TABLES,
  RELATIONAL_TABLES,
  TOKEN_TTL_HOURS,

  // Export (portabilidade)
  collectUserData,

  // Deleção (esquecimento)
  requestDeletionToken,
  consumeDeletionToken,
  executeDeletion,

  // Internos exportados para teste unitário
  anonymizeAuditLog,
  softDeleteProfile,
  cancelSubscription,
  purgeOperationalData,
};
