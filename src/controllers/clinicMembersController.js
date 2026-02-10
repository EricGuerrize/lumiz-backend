const { z } = require('zod');
const clinicMemberService = require('../services/clinicMemberService');
const { normalizePhone } = require('../utils/phone');

const createMemberSchema = z.object({
  telefone: z.string().min(10, 'Telefone inválido'),
  nome: z.string().min(2, 'Nome inválido'),
  funcao: z.enum(['dona', 'gestora', 'adm', 'financeiro', 'secretaria', 'profissional'])
});

const updateMemberSchema = z.object({
  nome: z.string().min(2, 'Nome inválido').optional(),
  funcao: z.enum(['dona', 'gestora', 'adm', 'financeiro', 'secretaria', 'profissional']).optional(),
  is_active: z.boolean().optional(),
  is_primary: z.any().optional()
});

class ClinicMembersController {
  async list(req, res) {
    try {
      const clinicId = req.user?.id;
      if (!clinicId) {
        return res.status(401).json({ success: false, error: 'Não autenticado' });
      }

      const members = await clinicMemberService.listMembers(clinicId, { includeInactive: true });
      return res.json({ success: true, data: members });
    } catch (error) {
      console.error('[CLINIC_MEMBERS] Erro ao listar membros:', error);
      return res.status(500).json({ success: false, error: 'Erro ao listar membros' });
    }
  }

  async create(req, res) {
    try {
      const clinicId = req.user?.id;
      const requesterPhone = req.user?.telefone;
      if (!clinicId || !requesterPhone) {
        return res.status(401).json({ success: false, error: 'Não autenticado' });
      }

      const hasPermission = await clinicMemberService.hasAdminPermission(requesterPhone);
      if (!hasPermission) {
        return res.status(403).json({ success: false, error: 'Sem permissão para adicionar membros' });
      }

      const parsed = createMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: parsed.error.issues[0]?.message || 'Dados inválidos'
        });
      }

      const payload = parsed.data;
      const result = await clinicMemberService.addMember({
        clinicId,
        telefone: normalizePhone(payload.telefone) || payload.telefone,
        nome: payload.nome.trim(),
        funcao: payload.funcao,
        createdBy: clinicId,
        isPrimary: false
      });

      if (!result.success) {
        if (result.error === 'PHONE_ALREADY_LINKED') {
          return res.status(409).json({
            success: false,
            error: `Este número já está vinculado à clínica "${result.existingClinic?.nome_clinica || 'outra clínica'}".`
          });
        }
        return res.status(400).json({ success: false, error: result.error || 'Erro ao adicionar membro' });
      }

      return res.status(201).json({ success: true, data: result.member });
    } catch (error) {
      console.error('[CLINIC_MEMBERS] Erro ao criar membro:', error);
      return res.status(500).json({ success: false, error: 'Erro ao criar membro' });
    }
  }

  async update(req, res) {
    try {
      const clinicId = req.user?.id;
      const requesterPhone = req.user?.telefone;
      if (!clinicId || !requesterPhone) {
        return res.status(401).json({ success: false, error: 'Não autenticado' });
      }

      const hasPermission = await clinicMemberService.hasAdminPermission(requesterPhone);
      if (!hasPermission) {
        return res.status(403).json({ success: false, error: 'Sem permissão para alterar membros' });
      }

      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ success: false, error: 'ID do membro é obrigatório' });
      }

      const parsed = updateMemberSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Dados inválidos' });
      }

      if (Object.prototype.hasOwnProperty.call(parsed.data, 'is_primary')) {
        return res.status(400).json({ success: false, error: 'Não é permitido alterar membro principal por esta rota' });
      }

      const result = await clinicMemberService.updateMember(clinicId, id, parsed.data);
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      return res.json({ success: true, data: result.member });
    } catch (error) {
      console.error('[CLINIC_MEMBERS] Erro ao atualizar membro:', error);
      return res.status(500).json({ success: false, error: 'Erro ao atualizar membro' });
    }
  }

  async remove(req, res) {
    try {
      const requesterPhone = req.user?.telefone;
      if (!requesterPhone) {
        return res.status(401).json({ success: false, error: 'Não autenticado' });
      }

      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ success: false, error: 'ID do membro é obrigatório' });
      }

      const result = await clinicMemberService.removeMember(id, requesterPhone);
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      return res.json({ success: true, data: { id } });
    } catch (error) {
      console.error('[CLINIC_MEMBERS] Erro ao remover membro:', error);
      return res.status(500).json({ success: false, error: 'Erro ao remover membro' });
    }
  }
}

module.exports = new ClinicMembersController();
