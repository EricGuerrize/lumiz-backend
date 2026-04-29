const subscriptionService = require('./subscriptionService');
const evolutionService = require('./evolutionService');
const userRepository = require('../repositories/userRepository');
const subscriptionCopy = require('../copy/subscriptionCopy');

async function checkAndSendReminders() {
  const sent = [];

  const [expiring7, expiring2] = await Promise.all([
    subscriptionService.getTrialsExpiringSoon(7),
    subscriptionService.getTrialsExpiringSoon(2)
  ]);

  for (const sub of expiring7) {
    if (sub.reminder_7d_sent_at) continue;

    const daysLeft = Math.ceil(
      (new Date(sub.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    // Skip if already covered by 2-day reminder
    if (daysLeft <= 2) continue;

    try {
      const profile = await userRepository.findById(sub.clinic_id);
      if (!profile?.telefone) continue;

      await evolutionService.sendMessage(profile.telefone, subscriptionCopy.trialReminder(daysLeft));
      await subscriptionService.markReminderSent(sub.clinic_id, 7);
      sent.push({ clinic_id: sub.clinic_id, type: 'reminder_7d', daysLeft });
    } catch (e) {
      console.error(`[TRIAL_REMINDER] Falha ao enviar lembrete 7d para ${sub.clinic_id}:`, e?.message);
    }
  }

  for (const sub of expiring2) {
    if (sub.reminder_2d_sent_at) continue;

    const daysLeft = Math.ceil(
      (new Date(sub.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    try {
      const profile = await userRepository.findById(sub.clinic_id);
      if (!profile?.telefone) continue;

      await evolutionService.sendMessage(profile.telefone, subscriptionCopy.trialReminder(daysLeft));
      await subscriptionService.markReminderSent(sub.clinic_id, 2);
      sent.push({ clinic_id: sub.clinic_id, type: 'reminder_2d', daysLeft });
    } catch (e) {
      console.error(`[TRIAL_REMINDER] Falha ao enviar lembrete 2d para ${sub.clinic_id}:`, e?.message);
    }
  }

  return sent;
}

module.exports = { checkAndSendReminders };
