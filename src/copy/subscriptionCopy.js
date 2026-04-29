const TRIAL_DAYS = 14;

const trialStarted = (daysLeft = TRIAL_DAYS) =>
  `✅ *Sua conta Lumiz está ativa!*\n\n` +
  `Você tem *${daysLeft} dias gratuitos* para explorar tudo que o Lumiz pode fazer pela sua clínica.\n\n` +
  `Durante o período de teste você pode:\n` +
  `• Registrar receitas e despesas por mensagem de texto ou foto 📸\n` +
  `• Consultar seu saldo, relatórios e insights financeiros\n` +
  `• Cadastrar as taxas das suas maquininhas\n\n` +
  `Qualquer dúvida, é só me chamar. Bom uso! 🚀`;

const trialReminder = (daysLeft) => {
  const urgency = daysLeft <= 2 ? '⚠️' : '📅';
  const days = daysLeft === 1 ? '1 dia' : `${daysLeft} dias`;
  return (
    `${urgency} *Seu período de teste termina em ${days}*\n\n` +
    `Para continuar usando o Lumiz sem interrupção, assine o plano mensal por apenas *R$ 149,99/mês*.\n\n` +
    `Responda *ASSINAR* a qualquer momento para receber o link de pagamento.`
  );
};

const subscriptionExpired = (paymentUrl) =>
  `🔒 *Seu período de teste terminou*\n\n` +
  `Para continuar registrando suas finanças e acessar seus relatórios, assine o plano Lumiz por *R$ 149,99/mês*.\n\n` +
  `👉 Clique aqui para assinar:\n${paymentUrl}\n\n` +
  `Aceitamos PIX, boleto e cartão de crédito. Após o pagamento, o acesso é liberado automaticamente!`;

const planActivated = () =>
  `🎉 *Pagamento confirmado! Bem-vindo ao Lumiz!*\n\n` +
  `Seu acesso está ativo. Pode continuar usando o bot normalmente — estou aqui para ajudar com suas finanças! 💚`;

module.exports = { trialStarted, trialReminder, subscriptionExpired, planActivated };
