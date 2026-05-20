/**
 * Servidor local de teste do onboarding com UI estilo WhatsApp.
 * Uso: node tests/test-onboarding-web.js
 * Abre automaticamente no browser em http://localhost:4444
 */
'use strict';

process.env.ONBOARDING_V2 = process.env.ONBOARDING_V2 ?? 'true';

// ─── Mocks ───────────────────────────────────────────────────────────────────
const Module = require('module');
const _orig = Module.prototype.require;
const inMemoryState = new Map();

Module.prototype.require = function (...args) {
    const m = args[0];
    if (m.includes('analyticsService') || m.includes('posthogService'))
        return { track: async () => {}, identify: async () => {} };
    if (m.includes('onboardingService') && !m.includes('onboardingFlowService') && !m.includes('onboardingUtils'))
        return {
            getWhatsappState: async (p) => inMemoryState.get(p) ?? null,
            upsertWhatsappState: async (p, s) => { inMemoryState.set(p, s); return true; },
            clearWhatsappState: async (p) => { inMemoryState.delete(p); return true; }
        };
    if (m.includes('consentService'))
        return { recordConsent: async () => true, hasConsent: async () => true };
    if (m.includes('cacheService'))
        return { get: async () => null, set: async () => true, delete: async () => true };
    if (m.includes('db/supabase'))
        return { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }) };
    if (m.includes('userController'))
        return { createUserFromOnboarding: async () => ({ user: { id: 'local-001' } }), findUserByPhone: async () => ({ id: 'local-001' }) };
    if (m.includes('transactionController'))
        return { createAtendimento: async () => ({ id: 'tx-001' }), createContaPagar: async () => ({ id: 'cp-001' }) };
    if (m.includes('documentService'))
        return { processImage: async () => ({ transacoes: [] }), processDocumentFromBuffer: async () => ({ transacoes: [] }) };
    if (m.includes('knowledgeService'))
        return { saveInteraction: async () => true };
    if (m.includes('registrationTokenService'))
        return { generateSetupToken: async () => ({ registrationLink: 'https://lumiz-financeiro.vercel.app/setup-account?phone=LOCAL&token=DEMO-TOKEN' }) };
    if (m.includes('trialAccountService'))
        return { trialAccountService: { getTrialSummary: async () => null, activateTrial: async () => null }, buildForwardSummary: () => '(resumo de encaminhamento)', computeGhostSummary: () => null };
    if (m.includes('clinicMemberService'))
        return { addMember: async () => ({ success: true }) };
    if (m.includes('intentHeuristicService'))
        return { detectIntent: async () => null };
    if (m.includes('evolutionService'))
        return { sendText: async () => true, sendMedia: async () => true };
    if (m.includes('subscriptionService'))
        return { getStatus: async () => ({ plan: 'trial', active: true }) };
    if (m.includes('subscriptionCopy'))
        return { trialCta: () => '(CTA de assinatura)' };
    return _orig.apply(this, args);
};
// ─────────────────────────────────────────────────────────────────────────────

const http = require('http');
const onboardingFlow = require('../src/services/onboardingFlowService');

const PHONE = '5565900000001';
const PORT = 4444;

function reset() {
    onboardingFlow.onboardingStates?.delete(PHONE);
    const t = onboardingFlow.persistTimers?.get(PHONE);
    if (t) { clearTimeout(t); onboardingFlow.persistTimers?.delete(PHONE); }
    inMemoryState.delete(PHONE);
}

const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lumiz — Teste de Onboarding</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #e5ddd5; height: 100vh; display: flex; flex-direction: column; }

  /* Header */
  .header { background: #075e54; color: white; padding: 12px 16px; display: flex; align-items: center; gap: 12px; box-shadow: 0 2px 4px rgba(0,0,0,.3); }
  .avatar { width: 40px; height: 40px; border-radius: 50%; background: #25d366; display: flex; align-items: center; justify-content: center; font-size: 20px; }
  .header-info .name { font-weight: 600; font-size: 16px; }
  .header-info .status { font-size: 12px; opacity: .8; }
  .restart-btn { margin-left: auto; background: none; border: 1px solid rgba(255,255,255,.5); color: white; padding: 6px 14px; border-radius: 20px; cursor: pointer; font-size: 13px; }
  .restart-btn:hover { background: rgba(255,255,255,.1); }

  /* Chat */
  #chat { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 4px; }

  /* Bubbles */
  .bubble-wrap { display: flex; flex-direction: column; max-width: 72%; }
  .bubble-wrap.bot { align-self: flex-start; align-items: flex-start; }
  .bubble-wrap.user { align-self: flex-end; align-items: flex-end; }

  .bubble { padding: 8px 12px; border-radius: 8px; font-size: 14.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; box-shadow: 0 1px 2px rgba(0,0,0,.15); }
  .bubble-wrap.bot .bubble { background: white; border-top-left-radius: 0; }
  .bubble-wrap.user .bubble { background: #dcf8c6; border-top-right-radius: 0; }

  .time { font-size: 11px; color: #999; margin-top: 2px; padding: 0 4px; }

  /* Typing */
  .typing .bubble { background: white; }
  .dots span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #aaa; margin: 0 2px; animation: bounce .9s infinite; }
  .dots span:nth-child(2) { animation-delay: .15s; }
  .dots span:nth-child(3) { animation-delay: .3s; }
  @keyframes bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }

  /* Input */
  .input-area { background: #f0f0f0; padding: 8px 12px; display: flex; align-items: flex-end; gap: 8px; border-top: 1px solid #ddd; }
  #msg { flex: 1; border: none; border-radius: 24px; padding: 10px 16px; font-size: 15px; resize: none; max-height: 120px; background: white; outline: none; font-family: inherit; line-height: 1.4; }
  #send { width: 44px; height: 44px; border-radius: 50%; background: #075e54; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  #send:hover { background: #128c7e; }
  #send svg { fill: white; width: 20px; height: 20px; }

  /* WhatsApp markdown */
  b { font-weight: 600; }
  i { font-style: italic; }
  .mono { font-family: monospace; background: rgba(0,0,0,.06); padding: 0 3px; border-radius: 3px; }
</style>
</head>
<body>

<div class="header">
  <div class="avatar">💜</div>
  <div class="header-info">
    <div class="name">Lumiz</div>
    <div class="status">Teste local de onboarding</div>
  </div>
  <button class="restart-btn" onclick="restart()">↺ Reiniciar</button>
</div>

<div id="chat"></div>

<div class="input-area">
  <textarea id="msg" rows="1" placeholder="Digite uma mensagem..." autofocus></textarea>
  <button id="send" onclick="send()">
    <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
  </button>
</div>

<script>
const chat = document.getElementById('chat');
const msgEl = document.getElementById('msg');

function now() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Converte markdown WhatsApp (*bold*, _italic_, \`mono\`) para HTML
function waMd(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\\*(.*?)\\*/g, '<b>$1</b>')
    .replace(/_(.*?)_/g, '<i>$1</i>')
    .replace(/\`(.*?)\`/g, '<span class="mono">$1</span>');
}

function addBubble(text, who) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap ' + who;
  const b = document.createElement('div');
  b.className = 'bubble';
  b.innerHTML = waMd(text);
  const t = document.createElement('div');
  t.className = 'time';
  t.textContent = now();
  wrap.appendChild(b);
  wrap.appendChild(t);
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
}

function showTyping() {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap bot typing';
  wrap.id = 'typing';
  wrap.innerHTML = '<div class="bubble dots"><span></span><span></span><span></span></div>';
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
}

function hideTyping() {
  document.getElementById('typing')?.remove();
}

async function restart() {
  chat.innerHTML = '';
  const res = await fetch('/restart', { method: 'POST' });
  const { messages } = await res.json();
  for (const m of messages) addBubble(m, 'bot');
}

async function send() {
  const text = msgEl.value.trim();
  if (!text) return;
  msgEl.value = '';
  msgEl.style.height = 'auto';
  addBubble(text, 'user');
  showTyping();
  try {
    const res = await fetch('/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const { messages } = await res.json();
    hideTyping();
    for (const m of messages) {
      await new Promise(r => setTimeout(r, 300));
      addBubble(m, 'bot');
    }
  } catch(e) {
    hideTyping();
    addBubble('(erro interno — veja o terminal)', 'bot');
  }
}

msgEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

// Auto-resize textarea
msgEl.addEventListener('input', () => {
  msgEl.style.height = 'auto';
  msgEl.style.height = Math.min(msgEl.scrollHeight, 120) + 'px';
});

// Inicia
restart();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
    const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HTML);
        return;
    }

    if (req.method === 'POST' && req.url === '/restart') {
        reset();
        const first = await onboardingFlow.startIntroFlow(PHONE);
        res.writeHead(200, cors);
        res.end(JSON.stringify({ messages: [first].filter(Boolean) }));
        return;
    }

    if (req.method === 'POST' && req.url === '/message') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                const result = await onboardingFlow.processOnboarding(PHONE, text ?? '');
                const messages = Array.isArray(result) ? result : [result];
                res.writeHead(200, cors);
                res.end(JSON.stringify({ messages: messages.filter(Boolean) }));
            } catch (e) {
                console.error('[ERRO]', e.message);
                res.writeHead(500, cors);
                res.end(JSON.stringify({ messages: ['(erro: ' + e.message + ')'] }));
            }
        });
        return;
    }

    res.writeHead(404); res.end();
});

server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n🟢 Lumiz Onboarding Tester rodando em ${url}`);
    console.log(`   Fluxo: ${process.env.ONBOARDING_V2 === 'true' ? 'V2 (5 Atos)' : 'V1 (legado)'}`);
    console.log(`   Ctrl+C para encerrar\n`);
    // Abre o browser automaticamente
    const { exec } = require('child_process');
    exec(`open "${url}"`);
});
