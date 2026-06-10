const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const betaFeedbackService = require('../services/betaFeedbackService');
const { authenticateToken } = require('../middleware/authMiddleware');
const evolutionService = require('../services/evolutionService');
const whatsappLatencyService = require('../services/whatsappLatencyService');
const messageReliabilityService = require('../services/messageReliabilityService');

const ONBOARDING_FUNNEL_EVENTS = [
  { key: 'onboarding_started', label: 'Iniciou' },
  { key: 'onboarding_consent_given', label: 'Consentiu' },
  { key: 'onboarding_profile_completed', label: 'Perfil' },
  { key: 'onboarding_first_sale', label: 'Venda teste' },
  { key: 'onboarding_cost_recorded', label: 'Custo teste' },
  { key: 'onboarding_summary_shown', label: 'Raio-x' },
  { key: 'onboarding_completed', label: 'Concluiu' },
];

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  return `...${digits.slice(-4)}`;
}

function safeText(value, max = 900) {
  if (value == null) return null;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function minutesSince(dateLike) {
  if (!dateLike) return null;
  const ms = Date.now() - new Date(dateLike).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 60000));
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const keys = Object.keys(payload).slice(0, 8);
  return {
    keys,
    kind: payload.kind || payload.type || payload.messageType || payload.pendingType || null,
    intent: payload.intent || payload.pendingIntent || null,
    hasTransactions: Array.isArray(payload.transactions) ? payload.transactions.length : undefined,
    supplierDocumentId: payload.supplier_document_id || payload.supplierDocumentId || null,
  };
}

function countBy(rows, field) {
  return (rows || []).reduce((acc, row) => {
    const key = row?.[field] || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

async function safeQuery(label, run, warnings) {
  try {
    const { data, error, count } = await run();
    if (error) {
      warnings.push({ source: label, message: error.message, code: error.code || null });
      return { data: [], count: count || 0 };
    }
    return { data: data || [], count: count || 0 };
  } catch (err) {
    warnings.push({ source: label, message: err.message || String(err), code: null });
    return { data: [], count: 0 };
  }
}

// Verifica se o usuário autenticado é admin via service-role.
// Evita depender de EXECUTE em RPCs expostas ao cliente.
async function requireAdmin(req, res, next) {
  try {
    const { data: role, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (error || role?.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso restrito' });
    }
    next();
  } catch {
    return res.status(403).json({ error: 'Acesso restrito' });
  }
}

router.use(authenticateToken);
router.use(requireAdmin);

// GET /api/admin/diagnostics/evolution
// Diagnóstico rápido de conectividade/config do WhatsApp (não expõe secrets).
// Provider principal: Meta Cloud API. Evolution aparece apenas se configurada (legado).
router.get('/diagnostics/evolution', async (req, res) => {
  const metaWhatsappService = require('../services/metaWhatsappService');
  const metaConfigured = metaWhatsappService.isOutboundConfigured();

  const diagnostics = {
    provider: 'meta',
    configured: metaConfigured,
    hasAccessToken: !!process.env.WA_ACCESS_TOKEN,
    hasPhoneNumberId: !!process.env.WA_PHONE_NUMBER_ID,
    hasAppSecret: !!process.env.META_APP_SECRET,
    connectionState: { state: metaConfigured ? 'configured' : 'not_configured' },
    legacyEvolutionConfigured: evolutionService.isConfigured(),
    latency: whatsappLatencyService.snapshot(),
    reliability: messageReliabilityService.snapshot(),
    error: null
  };

  res.json(diagnostics);
});

// GET /api/admin/whatsapp-monitor?days=7&limit=80
// Visão operacional do bot no WhatsApp: conversas recentes, estados ativos e falhas.
router.get('/whatsapp-monitor', async (req, res) => {
  const warnings = [];

  try {
    const days = clampInt(req.query.days, 7, 1, 30);
    const limit = clampInt(req.query.limit, 80, 20, 200);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const [conversationResult, runtimeResult, onboardingResult, analyticsResult] = await Promise.all([
      safeQuery('conversation_history', () => supabase
        .from('conversation_history')
        .select('id, user_id, user_message, bot_response, intent, context, feedback, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(limit), warnings),
      safeQuery('conversation_runtime_states', () => supabase
        .from('conversation_runtime_states')
        .select('id, phone, flow, payload, expires_at, created_at, updated_at')
        .gt('expires_at', now)
        .order('updated_at', { ascending: false })
        .limit(200), warnings),
      safeQuery('onboarding_progress', () => supabase
        .from('onboarding_progress')
        .select('id, phone, user_id, stage, phase, progress_percent, completed, completed_at, updated_at, created_at')
        .eq('completed', false)
        .order('updated_at', { ascending: true })
        .limit(200), warnings),
      safeQuery('analytics_events', () => supabase
        .from('analytics_events')
        .select('event_name')
        .gte('created_at', since)
        .limit(8000), warnings),
    ]);

    const conversationsRaw = conversationResult.data;
    const runtimeRaw = runtimeResult.data;
    const onboardingRaw = onboardingResult.data;
    const analyticsRaw = analyticsResult.data;

    const profileIds = [...new Set(conversationsRaw.map((row) => row.user_id).filter(Boolean))];
    let profilesById = {};
    if (profileIds.length > 0) {
      const profileResult = await safeQuery('profiles', () => supabase
        .from('profiles')
        .select('id, nome_completo, nome_clinica, telefone, is_active, created_at, updated_at')
        .in('id', profileIds), warnings);
      profilesById = Object.fromEntries(profileResult.data.map((profile) => [profile.id, profile]));
    }

    const conversations = conversationsRaw.map((row) => {
      const profile = profilesById[row.user_id] || {};
      return {
        id: row.id,
        user_id: row.user_id,
        clinic_name: profile.nome_clinica || null,
        contact_name: profile.nome_completo || null,
        phone_masked: maskPhone(profile.telefone),
        user_message: safeText(row.user_message),
        bot_response: safeText(row.bot_response, 1200),
        intent: row.intent || null,
        feedback: row.feedback || null,
        context: row.context || {},
        created_at: row.created_at,
        age_minutes: minutesSince(row.created_at),
      };
    });

    const runtimeStates = runtimeRaw.map((row) => {
      const ageMinutes = minutesSince(row.updated_at || row.created_at);
      return {
        id: row.id,
        phone_masked: maskPhone(row.phone),
        flow: row.flow,
        created_at: row.created_at,
        updated_at: row.updated_at,
        expires_at: row.expires_at,
        age_minutes: ageMinutes,
        stale: ageMinutes != null ? ageMinutes >= 15 : false,
        payload_summary: summarizePayload(row.payload),
      };
    });

    const onboarding = onboardingRaw.map((row) => {
      const ageMinutes = minutesSince(row.updated_at || row.created_at);
      return {
        id: row.id,
        user_id: row.user_id || null,
        phone_masked: maskPhone(row.phone),
        stage: row.stage || null,
        phase: row.phase ?? null,
        progress_percent: row.progress_percent ?? null,
        completed: Boolean(row.completed),
        created_at: row.created_at,
        updated_at: row.updated_at,
        age_minutes: ageMinutes,
        stale: ageMinutes != null ? ageMinutes >= 24 * 60 : false,
      };
    });

    const eventCounts = countBy(analyticsRaw, 'event_name');
    const funnel = ONBOARDING_FUNNEL_EVENTS.map((event) => ({
      event: event.key,
      label: event.label,
      count: eventCounts[event.key] || 0,
    }));

    const latency = whatsappLatencyService.snapshot();
    const reliability = messageReliabilityService.snapshot();
    const recentLatency = latency?.recent || [];
    const slowEvents = recentLatency.filter((event) => Number(event.total_ms || event.totalMs || 0) >= 10000).length;

    res.json({
      window: {
        days,
        since,
        generated_at: now,
      },
      summary: {
        conversations: conversations.length,
        unique_users: profileIds.length,
        active_runtime_states: runtimeStates.length,
        stale_runtime_states: runtimeStates.filter((row) => row.stale).length,
        active_onboarding: onboarding.length,
        stale_onboarding: onboarding.filter((row) => row.stale).length,
        failures: reliability?.summary?.totalFailures || reliability?.summary?.total || reliability?.total || 0,
        slow_events: slowEvents,
        avg_processing_ms: latency?.summary?.avgProcessingMs || 0,
        avg_send_ms: latency?.summary?.avgSendMs || 0,
        avg_total_ms: latency?.summary?.avgTotalMs || 0,
      },
      funnel,
      conversations,
      runtime_states: runtimeStates,
      onboarding,
      latency,
      reliability,
      meta: {
        is_empty: conversations.length === 0 && runtimeStates.length === 0 && onboarding.length === 0,
        hint: 'Dados administrativos: mensagens completas aparecem apenas para usuários admin autenticados.',
        warnings,
      },
    });
  } catch (err) {
    console.error('[ADMIN] whatsapp-monitor:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/stats
// Cards de resumo: usuários, feedbacks por tipo
router.get('/stats', async (req, res) => {
  try {
    const [{ count: totalUsers }, feedbackStats] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      betaFeedbackService.stats()
    ]);

    // Usuários ativos nos últimos 7 dias via conversation_history
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentIds } = await supabase
      .from('conversation_history')
      .select('user_id')
      .gte('created_at', since);

    const activeThisWeek = new Set((recentIds || []).map(r => r.user_id)).size;

    res.json({
      totalUsers: totalUsers || 0,
      activeThisWeek,
      feedback: feedbackStats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users
// Lista todos os usuários beta com status e última atividade
router.get('/users', async (req, res) => {
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, nome_completo, telefone, nome_clinica, created_at, beta_started_at, beta_expires_at, beta_blocked_at, is_active')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    // Última mensagem de cada usuário
    const ids = (profiles || []).map(p => p.id);
    let lastMessages = [];
    if (ids.length > 0) {
      const { data } = await supabase
        .from('conversation_history')
        .select('user_id, created_at, user_message')
        .in('user_id', ids)
        .order('created_at', { ascending: false });

      // Pega só a última de cada user_id
      const seen = new Set();
      lastMessages = (data || []).filter(row => {
        if (seen.has(row.user_id)) return false;
        seen.add(row.user_id);
        return true;
      });
    }

    const lastMap = Object.fromEntries(lastMessages.map(m => [m.user_id, m]));

    const result = (profiles || []).map(p => ({
      ...p,
      last_message_at: lastMap[p.id]?.created_at || null,
      last_message:    lastMap[p.id]?.user_message?.substring(0, 60) || null
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/subscription-stats
// Métricas de assinatura: totais + lista de clínicas com status de plano
router.get('/subscription-stats', async (req, res) => {
  try {
    // Usa RPC com SECURITY DEFINER para bypassar RLS independente do key configurado
    const { data: clinicsRaw, error: rpcError } = await supabase
      .rpc('admin_get_subscription_stats');

    if (rpcError) throw rpcError;

    const clinics_base = clinicsRaw || [];
    const ids = clinics_base.map(c => c.id);

    // Última mensagem de cada clínica via conversation_history
    let lastMap = {};
    if (ids.length > 0) {
      const { data: msgs } = await supabase
        .from('conversation_history')
        .select('user_id, created_at')
        .in('user_id', ids)
        .order('created_at', { ascending: false });

      const seen = new Set();
      (msgs || []).forEach(m => {
        if (!seen.has(m.user_id)) {
          seen.add(m.user_id);
          lastMap[m.user_id] = m.created_at;
        }
      });
    }

    const clinics = clinics_base.map(c => ({
      ...c,
      days_remaining: c.days_remaining != null ? Number(c.days_remaining) : null,
      last_message_at: lastMap[c.id] || null,
    }));

    const summary = {
      total: clinics.length,
      trial:   clinics.filter(c => c.status === 'trial').length,
      paid:    clinics.filter(c => c.status === 'paid').length,
      expired: clinics.filter(c => c.status === 'expired' || c.status === 'cancelled').length,
      no_plan: clinics.filter(c => !c.status).length,
    };

    res.json({ summary, clinics });
  } catch (err) {
    console.error('[ADMIN] subscription-stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/feedback?type=&limit=&offset=
router.get('/feedback', async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit  || 50), 200);
    const offset = Number(req.query.offset || 0);
    const type   = req.query.type || null;

    const data = await betaFeedbackService.list({ limit, offset, type });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/conversational-nps?limit=&offset=&since=
// Respostas NPS 0–10 coletadas no WhatsApp (cap. 13.4)
router.get('/conversational-nps', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const offset = Math.max(0, Number(req.query.offset || 0));
    const since = req.query.since ? String(req.query.since).trim() : null;

    let q = supabase
      .from('conversational_nps_responses')
      .select('id, user_id, phone, score, comment, raw_message, source, created_at')
      .order('created_at', { ascending: false });

    if (since) {
      q = q.gte('created_at', since);
    }

    const { data, error } = await q.range(offset, offset + limit - 1);
    if (error) {
      if (error.code === '42P01') {
        return res.json({ items: [], meta: { is_empty: true, hint: 'Tabela ainda não aplicada no banco.' } });
      }
      throw error;
    }

    res.json({
      items: data || [],
      meta: {
        is_empty: !(data && data.length),
        hint: 'Fonte: WhatsApp (mensagens nps: 0–10).'
      }
    });
  } catch (err) {
    console.error('[ADMIN] conversational-nps:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/agentic-analytics?days=7
// Contagens de eventos `agentic_*` e billing webhook em analytics_events (últimos N dias).
router.get('/agentic-analytics', async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days || 7), 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('analytics_events')
      .select('event_name')
      .gte('created_at', since)
      .limit(8000);

    if (error) {
      if (error.code === '42P01') {
        return res.json({
          days,
          since,
          counts: {},
          meta: { is_empty: true, hint: 'Tabela analytics_events indisponível.' }
        });
      }
      throw error;
    }

    const counts = {};
    for (const row of data || []) {
      const n = row.event_name;
      if (!n) continue;
      if (
        n.startsWith('agentic_') ||
        n === 'subscription_activated_via_webhook' ||
        n === 'onboarding_act_entered'
      ) {
        counts[n] = (counts[n] || 0) + 1;
      }
    }

    res.json({
      days,
      since,
      counts,
      meta: {
        is_empty: Object.keys(counts).length === 0,
        hint: 'Amostra limitada a 8000 linhas — para relatórios pesados use SQL/BI.'
      }
    });
  } catch (err) {
    console.error('[ADMIN] agentic-analytics:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/trial-accounts?limit=50
// Contas-fantasma do onboarding (trial) para suporte e auditoria.
router.get('/trial-accounts', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);

    const { data, error } = await supabase
      .from('trial_accounts')
      .select('id, phone, clinic_id, owner_name, clinic_name, role, status, created_at, converted_at, referral_summary')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      if (error.code === '42P01') {
        return res.json({ items: [], meta: { is_empty: true, hint: 'Tabela trial_accounts não aplicada.' } });
      }
      throw error;
    }

    res.json({
      items: data || [],
      meta: {
        is_empty: !(data && data.length),
        hint: 'Não inclui snapshot completo (pode ser grande) — use clinic_id para inspeção no banco.'
      }
    });
  } catch (err) {
    console.error('[ADMIN] trial-accounts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
