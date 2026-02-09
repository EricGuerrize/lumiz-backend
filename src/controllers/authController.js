const { z } = require('zod');
const supabase = require('../db/supabase');
const { normalizePhone, getPhoneVariants } = require('../utils/phone');

class AuthController {
  async resolvePhone(req, res) {
    try {
      const schema = z.object({
        phone: z.string().min(8, 'Telefone inválido')
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Telefone inválido' });
      }

      const normalized = normalizePhone(parsed.data.phone) || parsed.data.phone;
      const variants = getPhoneVariants(normalized);

      let query = supabase
        .from('profiles')
        .select('email, telefone')
        .not('email', 'is', null)
        .limit(1);

      if (variants.length > 0) {
        query = query.in('telefone', variants);
      } else {
        query = query.eq('telefone', normalized);
      }

      const { data: profile, error } = await query.maybeSingle();

      if (error || !profile?.email) {
        return res.status(404).json({
          error: 'Não encontramos cadastro com esse telefone. Finalize o onboarding e crie seu acesso primeiro.'
        });
      }

      return res.json({
        loginIdentifier: profile.email
      });
    } catch (error) {
      console.error('[AUTH] Erro ao resolver telefone:', error);
      return res.status(500).json({ error: 'Erro interno ao resolver telefone' });
    }
  }
}

module.exports = new AuthController();
