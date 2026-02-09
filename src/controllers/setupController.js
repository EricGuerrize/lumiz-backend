const { z } = require('zod');
const registrationTokenService = require('../services/registrationTokenService');
const userController = require('./userController');
const supabase = require('../db/supabase');

class SetupController {
  async validate(req, res) {
    try {
      const schema = z.object({
        token: z.string().min(10, 'Token inválido')
      });
      const parsed = schema.safeParse(req.query);

      if (!parsed.success) {
        return res.status(400).json({ valid: false, error: 'Token inválido' });
      }

      const { token } = parsed.data;
      const tokenInfo = await registrationTokenService.validateSetupToken(token);

      if (!tokenInfo.valid) {
        return res.status(400).json({ valid: false, error: 'Token inválido ou expirado' });
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, nome_clinica')
        .eq('telefone', tokenInfo.phone)
        .maybeSingle();

      return res.json({
        valid: true,
        clinicName: profile?.nome_clinica || 'Sua clínica',
        clinicId: profile?.id || tokenInfo.clinicId || null,
        expiresAt: tokenInfo.expiresAt || null
      });
    } catch (error) {
      console.error('[SETUP] Erro ao validar token:', error);
      return res.status(500).json({ valid: false, error: 'Erro interno ao validar token' });
    }
  }

  async complete(req, res) {
    try {
      const schema = z.object({
        token: z.string().min(10, 'Token inválido'),
        email: z.string().email('Email inválido'),
        password: z.string().min(6, 'A senha deve ter no mínimo 6 caracteres'),
        phone: z.string().optional()
      });
      const parsed = schema.safeParse(req.body);

      if (!parsed.success) {
        const issues = parsed.error.issues || [];
        return res.status(400).json({
          success: false,
          error: 'Dados inválidos',
          details: issues.map((issue) => issue.message)
        });
      }

      const tokenInfo = await registrationTokenService.validateSetupToken(parsed.data.token);
      if (!tokenInfo.valid) {
        return res.status(400).json({
          success: false,
          error: 'Token inválido ou expirado'
        });
      }

      req.body = {
        phone: tokenInfo.phone,
        token: parsed.data.token,
        email: parsed.data.email,
        password: parsed.data.password
      };

      return userController.linkEmail(req, res);
    } catch (error) {
      console.error('[SETUP] Erro ao completar setup:', error);
      return res.status(500).json({ success: false, error: 'Erro interno ao completar setup' });
    }
  }
}

module.exports = new SetupController();
