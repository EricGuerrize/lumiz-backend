const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const betaFeedbackService = require('../services/betaFeedbackService');
const { authenticateFlexible } = require('../middleware/authMiddleware');
const evolutionService = require('../services/evolutionService');

// Verifica se o usuário autenticado é admin
async function requireAdmin(req, res, next) {
  try {
    const { data: role } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (role?.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso restrito' });
    }
    next();
  } catch {
    return res.status(403).json({ error: 'Acesso restrito' });
  }
}

router.use(authenticateFlexible);
router.use(requireAdmin);

// GET /api/admin/diagnostics/evolution
// Diagnóstico rápido de conectividade/config (não expõe secrets)
router.get('/diagnostics/evolution', async (req, res) => {
  const baseUrl = process.env.EVOLUTION_API_URL || null;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME || null;
  const hasApiKey = !!process.env.EVOLUTION_API_KEY;

  const diagnostics = {
    configured: !!baseUrl && !!instanceName && hasApiKey,
    baseUrl,
    instanceName,
    hasApiKey,
    connectionState: null,
    error: null
  };

  try {
    const status = await evolutionService.getInstanceStatus();
    diagnostics.connectionState = status;
  } catch (err) {
    diagnostics.error = err?.response?.data || err?.message || 'unknown error';
  }

  res.json(diagnostics);
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
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, nome_clinica, email, telefone, created_at, is_active')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) throw error;

    const ids = (profiles || []).map(p => p.id);

    const [{ data: subscriptions }, lastMsgData] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('clinic_id, status, trial_ends_at, plan_expires_at')
        .in('clinic_id', ids),
      ids.length > 0
        ? supabase
            .from('conversation_history')
            .select('user_id, created_at')
            .in('user_id', ids)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] })
    ]);

    const subMap = Object.fromEntries((subscriptions || []).map(s => [s.clinic_id, s]));

    const seen = new Set();
    const lastMap = Object.fromEntries(
      (lastMsgData.data || [])
        .filter(row => { if (seen.has(row.user_id)) return false; seen.add(row.user_id); return true; })
        .map(m => [m.user_id, m])
    );

    const now = Date.now();
    const clinics = (profiles || []).map(p => {
      const sub = subMap[p.id] || null;
      const trialEndsAt = sub?.trial_ends_at ? new Date(sub.trial_ends_at) : null;
      const daysRemaining = trialEndsAt
        ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now) / (1000 * 60 * 60 * 24)))
        : null;
      return {
        id: p.id,
        nome_clinica: p.nome_clinica,
        email: p.email,
        telefone: p.telefone,
        created_at: p.created_at,
        is_active: p.is_active,
        status: sub?.status || null,
        trial_ends_at: sub?.trial_ends_at || null,
        plan_expires_at: sub?.plan_expires_at || null,
        days_remaining: daysRemaining,
        last_message_at: lastMap[p.id]?.created_at || null,
      };
    });

    const summary = {
      total: clinics.length,
      trial: clinics.filter(c => c.status === 'trial').length,
      paid: clinics.filter(c => c.status === 'paid').length,
      expired: clinics.filter(c => c.status === 'expired' || c.status === 'cancelled').length,
      no_plan: clinics.filter(c => !c.status).length,
    };

    res.json({ summary, clinics });
  } catch (err) {
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

module.exports = router;
