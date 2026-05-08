// Fase 19 — Templates de email LGPD (export + confirmação de exclusão).
// Mantenha o tom direto, em PT-BR, sem floreios. Não removendo branding,
// mas sem marketing — é comunicação legal/operacional.

const FROM_ADDRESS = 'Lumiz <privacidade@lumiz.com.br>';
const APP_URL = process.env.FRONTEND_URL || 'https://lumiz-financeiro.vercel.app';

function _safeName(profile) {
  if (!profile) return 'cliente';
  return profile.nome_completo || profile.nome_clinica || 'cliente';
}

function exportEmail({ profile, generatedAt, totalRows }) {
  const nome = _safeName(profile);
  const dataLegivel = new Date(generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return {
    from: FROM_ADDRESS,
    subject: 'Seus dados pessoais — Export Lumiz',
    html: `
      <h2>Olá, ${nome}.</h2>
      <p>Conforme solicitado, em anexo está o export completo dos seus dados na Lumiz.</p>
      <p><strong>Gerado em:</strong> ${dataLegivel}<br/>
      <strong>Total de registros exportados:</strong> ${totalRows}</p>
      <p>O arquivo segue o formato JSON, organizado por tabela do banco. Cada chave do
      objeto <code>tables</code> representa uma entidade (atendimentos, contas a pagar,
      audit log, etc.).</p>
      <p>Esse arquivo é seu — guarde com cuidado. Ele contém informações financeiras
      e operacionais da sua clínica.</p>
      <hr/>
      <p style="font-size:12px;color:#888">Lumiz · LGPD Art. 18, V — direito à
      portabilidade. Caso não tenha solicitado este export, responda este email.</p>
    `,
  };
}

function deletionConfirmEmail({ profile, token, expiraEm }) {
  const nome = _safeName(profile);
  const link = `${APP_URL}/conta/confirmar-exclusao?token=${encodeURIComponent(token)}`;
  const expira = new Date(expiraEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return {
    from: FROM_ADDRESS,
    subject: 'Confirme a exclusão da sua conta Lumiz',
    html: `
      <h2>Olá, ${nome}.</h2>
      <p>Você solicitou a exclusão da sua conta Lumiz.</p>
      <p>Para confirmar, clique no link abaixo. Ele é válido até <strong>${expira}</strong>.</p>
      <p style="margin:24px 0;">
        <a href="${link}" style="background:#7C3AED;color:#fff;padding:12px 20px;
        border-radius:6px;text-decoration:none;display:inline-block">
          Confirmar exclusão
        </a>
      </p>
      <p>O que vai acontecer quando você confirmar:</p>
      <ul>
        <li>Todos os seus dados operacionais (atendimentos, contas, fornecedores,
        documentos, estoque, metas) serão removidos.</li>
        <li>Seu histórico de auditoria será anonimizado (mantido sem identificação
        para conformidade interna).</li>
        <li>Sua assinatura ativa será cancelada.</li>
        <li>Seu perfil será desativado e seus dados pessoais zerados.</li>
      </ul>
      <p>Se você não pediu isso, ignore este email. Sua conta continua intacta.</p>
      <hr/>
      <p style="font-size:12px;color:#888">Lumiz · LGPD Art. 18, VI — direito à
      eliminação dos dados.</p>
    `,
  };
}

module.exports = {
  FROM_ADDRESS,
  exportEmail,
  deletionConfirmEmail,
};
