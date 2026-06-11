const { AlterAdapterContract } = require('./alterAdapterContract');
const supabase = require('../../db/supabase');

/**
 * RealAlterAdapter — integração com a API Alter (app.alterbr.com).
 *
 * Auth: OAuth2 client_credentials (token 24h, cache em memória com renovação
 * automática quando restar < 60s).
 *
 * Envs obrigatórias para ativar:
 *   ALTER_CLIENT_ID, ALTER_CLIENT_SECRET
 * Opcional:
 *   ALTER_API_URL (padrão: https://app.alterbr.com)
 *
 * Fluxo de dados:
 *   1. listRecebiveis() busca na API Alter e faz upsert em `alter_recebiveis`
 *      com source='alter_api'.
 *   2. getAggregatePosition() / simulateAntecipacaoSpot() /
 *      executeAntecipacaoSpot() lêem de `alter_recebiveis` após o sync.
 *   3. registerBusinessPartner() cria um BP na Alter e persiste o
 *      `alter_bp_id` no perfil do usuário.
 *   4. requestOptIn() dispara opt-in Núclea para um BP já cadastrado.
 */

const DEFAULT_FEE_SPOT_PCT = Number(process.env.ALTER_FEE_SPOT_PCT || 0.025);
const DEFAULT_FEE_SPOT_MIN_PCT = Number(process.env.ALTER_FEE_SPOT_MIN_PCT || 0.015);
const DEFAULT_FEE_SPOT_MAX_PCT = Number(process.env.ALTER_FEE_SPOT_MAX_PCT || 0.045);

// ─── Token cache ──────────────────────────────────────────────────────────────

let _tokenCache = null; // { access_token: string, expires_at: number (ms) }

function _baseUrl() {
  return (process.env.ALTER_API_URL || 'https://app.alterbr.com').replace(/\/$/, '');
}

async function _getToken() {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expires_at > now + 60_000) {
    return _tokenCache.access_token;
  }

  const clientId = process.env.ALTER_CLIENT_ID;
  const clientSecret = process.env.ALTER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('ALTER_CLIENT_ID e ALTER_CLIENT_SECRET são obrigatórios para o adapter real.');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: [
      'read:operations',
      'read:receivables',
      'read:business-partners',
      'read:contracts',
      'write:business-partners',
      'write:opt-in-requests'
    ].join(' ')
  });

  const res = await fetch(`${_baseUrl()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alter OAuth token falhou (${res.status}): ${text}`);
  }

  const json = await res.json();
  _tokenCache = {
    access_token: json.access_token,
    expires_at: now + (Number(json.expires_in) || 86400) * 1000
  };
  return _tokenCache.access_token;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function _request(method, path, { params = {}, body } = {}) {
  const token = await _getToken();
  const url = new URL(`${_baseUrl()}/api/partners/v1${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);

  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alter ${method} ${path} falhou (${res.status}): ${text}`);
  }
  return res.json();
}

async function _fetchAllPages(path, params = {}) {
  const results = [];
  let page = 1;
  while (true) {
    const json = await _request('GET', path, { params: { ...params, page, per_page: 100 } });
    results.push(...(json.data || []));
    if (!json.meta || page >= json.meta.last_page) break;
    page += 1;
  }
  return results;
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

/**
 * Mapeia um receivable da Alter para o shape interno (alter_recebiveis).
 * Campos sem equivalente na API (bandeira, mdr, data_venda, parcelas_*)
 * ficam null — o mock os preenche porque deriva de `parcelas`.
 */
function _mapReceivel(userId, r) {
  const available = Number(r.available_amount) || 0;
  const status = r.status === 'SETTLED'
    ? 'liquidado'
    : available > 0 ? 'livre' : 'comprometido';

  return {
    user_id: userId,
    adquirente: r.acquirer_id || null,
    bandeira: null,
    parcelas_total: 1,
    parcela_numero: 1,
    valor_bruto: Number(r.total_amount) || 0,
    valor_liquido: available,
    mdr: null,
    data_venda: null,
    data_disponivel: r.expected_settlement_date || null,
    status,
    source: 'alter_api',
    external_id: r.id,
    parcela_id: null
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _getAlterBpId(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('alter_bp_id')
    .eq('id', userId)
    .single();
  return data?.alter_bp_id || null;
}

/**
 * A API Alter envolve recursos únicos em `{ data: { id, ... } }`.
 * Aceita também o objeto plano para compatibilidade com respostas legadas.
 * @param {Object|null|undefined} json
 * @returns {Object}
 */
function _unwrapResource(json) {
  const resource = json?.data && typeof json.data === 'object' && !Array.isArray(json.data)
    ? json.data
    : json;
  if (!resource?.id) {
    throw new Error('Resposta da Alter sem id do recurso.');
  }
  return resource;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

class RealAlterAdapter extends AlterAdapterContract {
  isConfigured() {
    return Boolean(process.env.ALTER_CLIENT_ID && process.env.ALTER_CLIENT_SECRET);
  }

  /**
   * Busca recebíveis na API Alter, persiste em `alter_recebiveis` e retorna
   * as linhas filtradas. Se o usuário não tiver `alter_bp_id` cadastrado,
   * retorna array vazio sem erro.
   */
  async listRecebiveis(userId, filters = {}) {
    if (!userId) throw new Error('userId obrigatório.');

    const bpId = await _getAlterBpId(userId);
    if (!bpId) return [];

    // Mapeia filtros internos → parâmetros da API Alter
    const apiParams = { client_id: bpId };
    if (filters.from) apiParams.due_from = filters.from;
    if (filters.to) apiParams.due_to = filters.to;
    if (filters.status) {
      // 'liquidado' → SETTLED; qualquer outro → AVAILABLE
      apiParams.status = filters.status === 'liquidado' ? 'SETTLED' : 'AVAILABLE';
    }

    const raw = await _fetchAllPages('/receivables', apiParams);

    if (raw.length > 0) {
      const rows = raw.map((r) => _mapReceivel(userId, r));
      const { error } = await supabase
        .from('alter_recebiveis')
        .upsert(rows, { onConflict: 'user_id,source,external_id' });
      if (error) throw error;
    }

    // Lê da tabela local para que filtros adicionais (adquirente) funcionem
    let query = supabase
      .from('alter_recebiveis')
      .select('*')
      .eq('user_id', userId)
      .eq('source', 'alter_api')
      .order('data_disponivel', { ascending: true });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.adquirente) query = query.eq('adquirente', filters.adquirente);
    if (filters.from) query = query.gte('data_disponivel', filters.from);
    if (filters.to) query = query.lte('data_disponivel', filters.to);

    const { data, error: readError } = await query;
    if (readError) throw readError;
    return data || [];
  }

  async getAggregatePosition(userId) {
    const recebiveis = await this.listRecebiveis(userId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const aggr = { livre: 0, comprometido: 0, antecipado: 0, liquidado_30d: 0 };
    for (const r of recebiveis) {
      const valor = parseFloat(r.valor_liquido) || 0;
      if (r.status === 'livre') aggr.livre += valor;
      else if (r.status === 'comprometido') aggr.comprometido += valor;
      else if (r.status === 'antecipado') aggr.antecipado += valor;
      if (r.status === 'liquidado' && r.data_disponivel) {
        const liq = new Date(`${r.data_disponivel}T12:00:00`);
        if ((today - liq) / 86400000 <= 30) aggr.liquidado_30d += valor;
      }
    }
    return aggr;
  }

  /**
   * Simulação local usando recebíveis livres da Alter.
   * (Não há endpoint de antecipação na API Alter v1.)
   */
  async simulateAntecipacaoSpot(userId, params = {}) {
    const valorAlvo = Math.max(0, Number(params.valor_alvo) || 0);
    const horizonte = Math.max(1, Math.min(365, Number(params.horizonte_dias) || 30));
    if (valorAlvo === 0) {
      return {
        valor_solicitado: 0,
        valor_liquido_recebido: 0,
        custo_antecipacao: 0,
        taxa_efetiva_pct: 0,
        recebiveis_ids: [],
        status: 'simulada'
      };
    }

    const recebiveis = await this.listRecebiveis(userId, { status: 'livre' });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const candidatos = recebiveis
      .map((r) => {
        const data = new Date(`${r.data_disponivel}T12:00:00`);
        const diasFuturo = Math.max(0, Math.floor((data - today) / 86400000));
        const taxaSpot = Math.min(
          DEFAULT_FEE_SPOT_MAX_PCT,
          Math.max(DEFAULT_FEE_SPOT_MIN_PCT, DEFAULT_FEE_SPOT_PCT * (diasFuturo / 30))
        );
        return { ...r, _diasFuturo: diasFuturo, _taxaSpot: taxaSpot };
      })
      .sort((a, b) => a._diasFuturo - b._diasFuturo);

    let acumulado = 0;
    let custoTotal = 0;
    const escolhidos = [];
    for (const r of candidatos) {
      if (acumulado >= valorAlvo) break;
      const valorBruto = parseFloat(r.valor_liquido) || 0;
      const custo = valorBruto * r._taxaSpot;
      const liquido = valorBruto - custo;
      acumulado += liquido;
      custoTotal += custo;
      escolhidos.push(r);
    }

    const taxaEfetiva = acumulado > 0 ? custoTotal / (acumulado + custoTotal) : 0;

    return {
      valor_solicitado: valorAlvo,
      valor_liquido_recebido: Math.round(acumulado * 100) / 100,
      custo_antecipacao: Math.round(custoTotal * 100) / 100,
      taxa_efetiva_pct: Math.round(taxaEfetiva * 10000) / 10000,
      recebiveis_ids: escolhidos.map((r) => r.id),
      status: 'simulada',
      cobre_alvo: acumulado >= valorAlvo,
      gap_versus_alvo: Math.max(0, Math.round((valorAlvo - acumulado) * 100) / 100),
      horizonte_dias: horizonte
    };
  }

  async executeAntecipacaoSpot(userId, params = {}) {
    const simulacao = params.simulacao || await this.simulateAntecipacaoSpot(userId, params);
    if (!simulacao.recebiveis_ids?.length) {
      return { ...simulacao, status: 'falhou', erro: 'Sem recebíveis livres suficientes.' };
    }

    const { data: created, error: insertError } = await supabase
      .from('alter_antecipacoes')
      .insert({
        user_id: userId,
        tipo: 'spot',
        valor_solicitado: simulacao.valor_solicitado,
        valor_liquido_recebido: simulacao.valor_liquido_recebido,
        custo_antecipacao: simulacao.custo_antecipacao,
        taxa_efetiva_pct: simulacao.taxa_efetiva_pct,
        recebiveis_ids: simulacao.recebiveis_ids,
        status: 'executada',
        payload_simulacao: simulacao
      })
      .select('*')
      .single();
    if (insertError) throw insertError;

    const { error: updateError } = await supabase
      .from('alter_recebiveis')
      .update({ status: 'antecipado', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('id', simulacao.recebiveis_ids);
    if (updateError) throw updateError;

    return created;
  }

  async cancelAutomatica(userId) {
    // Antecipação automática não tem endpoint na API Alter v1.
    return { userId, status: 'noop', message: 'Antecipação automática não disponível na API Alter v1.' };
  }

  // ─── Métodos extras (fora do contrato base) ─────────────────────────────────

  /**
   * Cria um Business Partner na Alter para uma clínica e persiste o
   * `alter_bp_id` no perfil do usuário.
   *
   * @param {string} userId
   * @param {{ name: string, cnpj: string, email?: string, phone?: string }} bp
   * @returns {Promise<Object>} BP criado pela Alter
   */
  async registerBusinessPartner(userId, bp) {
    if (!userId || !bp?.cnpj) throw new Error('userId e cnpj são obrigatórios.');

    const payload = {
      name: bp.name,
      document_number: bp.cnpj.replace(/\D/g, ''),
      ...(bp.email && { email: bp.email }),
      ...(bp.phone && { phone: bp.phone })
    };

    const created = await _request('POST', '/business-partners', { body: payload });
    const partner = _unwrapResource(created);

    // Persiste o Alter BP id no perfil para lookups futuros
    const { error } = await supabase
      .from('profiles')
      .update({ alter_bp_id: partner.id })
      .eq('id', userId);
    if (error) throw error;

    return partner;
  }

  /**
   * Dispara opt-in Núclea para o BP já cadastrado.
   * Retorna 200 se já estava ativo, 202 se foi despachado.
   *
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async requestOptIn(userId) {
    if (!userId) throw new Error('userId obrigatório.');
    const bpId = await _getAlterBpId(userId);
    if (!bpId) throw new Error('Usuário não tem alter_bp_id. Chame registerBusinessPartner primeiro.');
    return _request('POST', `/business-partners/${bpId}/opt-in-request`);
  }

  /**
   * Retorna o BP da Alter para este usuário (inclui status do opt-in Núclea).
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  async getBusinessPartner(userId) {
    if (!userId) throw new Error('userId obrigatório.');
    const bpId = await _getAlterBpId(userId);
    if (!bpId) return null;
    const remote = await _request('GET', `/business-partners/${bpId}`);
    return remote ? _unwrapResource(remote) : null;
  }

  /**
   * Registra (ou atualiza) a URL de webhook da conta Alter.
   * O secret HMAC é enviado pela Alter em canal separado.
   * @param {string} webhookUrl
   */
  async setWebhookUrl(webhookUrl) {
    return _request('PATCH', '/me/webhook-url', { body: { webhook_url: webhookUrl } });
  }
}

const instance = new RealAlterAdapter();
module.exports = instance;
module.exports.RealAlterAdapter = RealAlterAdapter;
