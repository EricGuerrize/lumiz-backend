const supabase = require('../db/supabase');

async function alreadySent(referenciaId, tipoLembrete) {
  const { data } = await supabase
    .from('reminders_sent')
    .select('id')
    .eq('referencia_id', referenciaId)
    .eq('tipo_lembrete', tipoLembrete)
    .maybeSingle();
  return !!data;
}

async function markSent(userId, referenciaId, tipoLembrete) {
  await supabase.from('reminders_sent').upsert(
    { user_id: userId, referencia_id: referenciaId, tipo_lembrete: tipoLembrete },
    { onConflict: 'referencia_id,tipo_lembrete' }
  );
}

module.exports = { alreadySent, markSent };
