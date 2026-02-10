/**
 * Serviço para gerenciamento de membros de clínica
 * Permite vincular múltiplos números WhatsApp a uma mesma clínica
 */

const supabase = require('../db/supabase');
const { normalizePhone, getPhoneVariants } = require('../utils/phone');

class ClinicMemberService {
  constructor() {
    // Armazena transferências pendentes
    // chave: telefone do dono atual, valor: dados da transferência
    this.pendingTransfers = new Map();
  }
  /**
   * Busca um membro pelo telefone
   * @param {string} phone - Número de telefone
   * @returns {Object|null} - Membro encontrado ou null
   */
  async findMemberByPhone(phone, options = {}) {
    const { includeInactive = false } = options;
    const normalizedPhone = normalizePhone(phone) || phone;
    const variants = getPhoneVariants(phone);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'clinicMemberService.js:21',message:'Buscando membro por telefone',data:{originalPhone:phone,normalizedPhone:normalizedPhone,variantsCount:variants.length,variants:variants},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    // Tenta busca com variantes primeiro (mais robusto)
    let memberQuery = supabase
      .from('clinic_members')
      .select('*, profiles:clinic_id(*)');
    
    if (!includeInactive) {
      memberQuery = memberQuery.eq('is_active', true);
    }
    
    if (variants.length > 0) {
      memberQuery = memberQuery.in('telefone', variants);
    } else {
      memberQuery = memberQuery.eq('telefone', normalizedPhone);
    }
    
    const { data, error } = await memberQuery.maybeSingle();
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'clinicMemberService.js:36',message:'Resultado busca membro',data:{found:!!data,errorCode:error?.code,errorMessage:error?.message,memberId:data?.id,clinicId:data?.clinic_id,phoneInDb:data?.telefone},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    if (error && error.code !== 'PGRST116') {
      // PGRST116 = não encontrado, outros erros são problemas reais
      console.error('[CLINIC_MEMBER] Erro ao buscar membro:', error);
      return null;
    }
    
    return data || null;
  }

  /**
   * Busca a clínica associada a um telefone (membro ou profile principal)
   * @param {string} phone - Número de telefone
   * @returns {Object|null} - { clinic, member } ou null
   */
  async findClinicByMemberPhone(phone) {
    // Primeiro tenta buscar em clinic_members (usa variantes internamente)
    const member = await this.findMemberByPhone(phone);
    
    if (member) {
      return {
        clinic: member.profiles,
        member: {
          id: member.id,
          nome: member.nome,
          funcao: member.funcao,
          is_primary: member.is_primary,
          confirmed: member.confirmed
        }
      };
    }
    
    // Se não encontrou em clinic_members, busca diretamente em profiles
    const normalizedPhone = normalizePhone(phone) || phone;
    const variants = getPhoneVariants(phone);
    
    let profileQuery = supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true);
    
    if (variants.length > 0) {
      profileQuery = profileQuery.in('telefone', variants);
    } else {
      profileQuery = profileQuery.eq('telefone', normalizedPhone);
    }
    
    const { data: profile, error } = await profileQuery.maybeSingle();
    
    if (error || !profile) {
      return null;
    }
    
    // Retorna como se fosse o membro primário
    return {
      clinic: profile,
      member: {
        id: null,
        nome: profile.nome_completo,
        funcao: 'dona', // Assume dona se é o profile principal
        is_primary: true,
        confirmed: true
      }
    };
  }

  /**
   * Lista todos os membros de uma clínica
   * @param {string} clinicId - ID da clínica
   * @returns {Array} - Lista de membros
   */
  async listMembers(clinicId, options = {}) {
    const { includeInactive = false } = options;
    let query = supabase
      .from('clinic_members')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('[CLINIC_MEMBER] Erro ao listar membros:', error);
      return [];
    }
    
    return data || [];
  }

  /**
   * Adiciona um novo membro à clínica
   * @param {Object} params - Dados do novo membro
   * @returns {Object} - { success, member, error }
   */
  async addMember({ clinicId, telefone, nome, funcao, createdBy, isPrimary = false }) {
    const normalizedPhone = normalizePhone(telefone) || telefone;
    
    // Valida função
    const validFunctions = ['dona', 'gestora', 'adm', 'financeiro', 'secretaria', 'profissional'];
    if (!validFunctions.includes(funcao)) {
      return { success: false, error: 'Função inválida' };
    }
    
    // Verifica se telefone já está vinculado a outra clínica
    const existingMember = await this.findMemberByPhone(normalizedPhone, { includeInactive: true });
    if (existingMember && existingMember.clinic_id !== clinicId) {
      return { 
        success: false, 
        error: 'PHONE_ALREADY_LINKED',
        existingClinic: existingMember.profiles,
        existingMember: existingMember
      };
    }
    
    // Se já existe na mesma clínica, apenas reativa
    if (existingMember && existingMember.clinic_id === clinicId) {
      const { data, error } = await supabase
        .from('clinic_members')
        .update({ 
          is_active: true, 
          nome, 
          funcao,
          confirmed: existingMember.confirmed || isPrimary,
          confirmed_at: existingMember.confirmed || isPrimary ? (existingMember.confirmed_at || new Date().toISOString()) : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingMember.id)
        .select()
        .single();
      
      if (error) {
        console.error('[CLINIC_MEMBER] Erro ao reativar membro:', error);
        return { success: false, error: 'Erro ao atualizar membro' };
      }
      
      return { success: true, member: data, reactivated: true };
    }
    
    // Cria novo membro
    const { data, error } = await supabase
      .from('clinic_members')
      .insert({
        clinic_id: clinicId,
        telefone: normalizedPhone,
        nome,
        funcao,
        is_primary: isPrimary,
        is_active: true,
        confirmed: isPrimary, // Membro primário já está confirmado
        confirmed_at: isPrimary ? new Date().toISOString() : null,
        created_by: createdBy
      })
      .select()
      .single();
    
    if (error) {
      console.error('[CLINIC_MEMBER] Erro ao adicionar membro:', error);
      return { success: false, error: 'Erro ao adicionar membro' };
    }
    
    return { success: true, member: data };
  }

  /**
   * Confirma o vínculo de um membro
   * @param {string} phone - Telefone do membro
   * @returns {Object} - { success, error }
   */
  async confirmMember(phone) {
    const normalizedPhone = normalizePhone(phone) || phone;
    
    const { data, error } = await supabase
      .from('clinic_members')
      .update({ 
        confirmed: true, 
        confirmed_at: new Date().toISOString() 
      })
      .eq('telefone', normalizedPhone)
      .eq('is_active', true)
      .select()
      .single();
    
    if (error) {
      console.error('[CLINIC_MEMBER] Erro ao confirmar membro:', error);
      return { success: false, error: 'Erro ao confirmar vínculo' };
    }
    
    return { success: true, member: data };
  }

  /**
   * Rejeita o vínculo de um membro (desativa)
   * @param {string} phone - Telefone do membro
   * @returns {Object} - { success, error }
   */
  async rejectMember(phone) {
    const normalizedPhone = normalizePhone(phone) || phone;
    
    const { error } = await supabase
      .from('clinic_members')
      .update({ is_active: false })
      .eq('telefone', normalizedPhone)
      .eq('confirmed', false); // Só pode rejeitar se ainda não confirmou
    
    if (error) {
      console.error('[CLINIC_MEMBER] Erro ao rejeitar membro:', error);
      return { success: false, error: 'Erro ao rejeitar vínculo' };
    }
    
    return { success: true };
  }

  /**
   * Remove um membro da clínica (soft delete)
   * @param {string} memberId - ID do membro
   * @param {string} requestedBy - Telefone de quem solicitou
   * @returns {Object} - { success, error }
   */
  async removeMember(memberId, requestedBy) {
    // Verifica se quem solicita tem permissão
    const hasPermission = await this.hasAdminPermission(requestedBy);
    if (!hasPermission) {
      return { success: false, error: 'Sem permissão para remover membros' };
    }

    // Resolve clinic_id do solicitante (membro ou profile principal)
    const requester = await this.findMemberByPhone(requestedBy);
    let clinicId = requester?.clinic_id;
    if (!clinicId) {
      const normalizedPhone = normalizePhone(requestedBy) || requestedBy;
      const variants = getPhoneVariants(requestedBy);
      let profileQuery = supabase.from('profiles').select('id');
      profileQuery = variants.length ? profileQuery.in('telefone', variants) : profileQuery.eq('telefone', normalizedPhone);
      const { data: profile } = await profileQuery.maybeSingle();
      clinicId = profile?.id || null;
    }

    if (!clinicId) {
      return { success: false, error: 'Clínica do solicitante não encontrada' };
    }
    
    const { error } = await supabase
      .from('clinic_members')
      .update({ is_active: false })
      .eq('id', memberId)
      .eq('clinic_id', clinicId)
      .neq('is_primary', true); // Não pode remover o membro primário
    
    if (error) {
      console.error('[CLINIC_MEMBER] Erro ao remover membro:', error);
      return { success: false, error: 'Erro ao remover membro' };
    }
    
    return { success: true };
  }

  /**
   * Atualiza dados do membro dentro da clínica
   * @param {string} clinicId - ID da clínica
   * @param {string} memberId - ID do membro
   * @param {Object} updates - Campos permitidos: nome, funcao, is_active
   * @returns {Object} - { success, member, error }
   */
  async updateMember(clinicId, memberId, updates = {}) {
    const allowedUpdates = {};
    if (typeof updates.nome === 'string' && updates.nome.trim()) {
      allowedUpdates.nome = updates.nome.trim();
    }
    if (typeof updates.funcao === 'string' && updates.funcao.trim()) {
      const validFunctions = ['dona', 'gestora', 'adm', 'financeiro', 'secretaria', 'profissional'];
      if (!validFunctions.includes(updates.funcao.trim())) {
        return { success: false, error: 'Função inválida' };
      }
      allowedUpdates.funcao = updates.funcao.trim();
    }
    if (typeof updates.is_active === 'boolean') {
      allowedUpdates.is_active = updates.is_active;
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return { success: false, error: 'Nenhum campo válido para atualizar' };
    }

    const { data: member, error: findError } = await supabase
      .from('clinic_members')
      .select('*')
      .eq('id', memberId)
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (findError || !member) {
      return { success: false, error: 'Membro não encontrado' };
    }

    if (member.is_primary && allowedUpdates.is_active === false) {
      return { success: false, error: 'Não é permitido desativar o membro principal' };
    }

    const { data, error } = await supabase
      .from('clinic_members')
      .update({
        ...allowedUpdates,
        updated_at: new Date().toISOString()
      })
      .eq('id', memberId)
      .eq('clinic_id', clinicId)
      .select('*')
      .single();

    if (error) {
      console.error('[CLINIC_MEMBER] Erro ao atualizar membro:', error);
      return { success: false, error: 'Erro ao atualizar membro' };
    }

    return { success: true, member: data };
  }

  /**
   * Transfere um número para outra clínica
   * @param {string} phone - Telefone a ser transferido
   * @param {string} newClinicId - ID da nova clínica
   * @param {Object} newMemberData - Dados do membro na nova clínica
   * @returns {Object} - { success, error }
   */
  async transferMember(phone, newClinicId, newMemberData) {
    const normalizedPhone = normalizePhone(phone) || phone;
    
    // Desativa na clínica antiga
    await supabase
      .from('clinic_members')
      .update({ is_active: false })
      .eq('telefone', normalizedPhone);
    
    // Cria na nova clínica
    return await this.addMember({
      clinicId: newClinicId,
      telefone: normalizedPhone,
      ...newMemberData
    });
  }

  /**
   * Verifica se um telefone tem permissão de administração
   * @param {string} phone - Telefone
   * @returns {boolean}
   */
  async hasAdminPermission(phone) {
    const member = await this.findMemberByPhone(phone);
    if (!member) {
      // Verifica se é o telefone principal do profile
      const normalizedPhone = normalizePhone(phone) || phone;
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('telefone', normalizedPhone)
        .eq('is_active', true)
        .single();
      
      return !!profile;
    }
    
    return ['dona', 'gestora'].includes(member.funcao);
  }

  /**
   * Mapeia número para função legível
   */
  mapRoleNumber(number) {
    const roleMap = {
      '1': 'dona',
      '2': 'adm',
      '3': 'secretaria',
      '4': 'profissional'
    };
    return roleMap[number] || number;
  }

  /**
   * Mapeia função para texto legível
   */
  getRoleName(funcao) {
    const names = {
      'dona': 'Dona/Gestora',
      'gestora': 'Gestora',
      'adm': 'Adm/Financeiro',
      'financeiro': 'Financeiro',
      'secretaria': 'Secretária',
      'profissional': 'Profissional'
    };
    return names[funcao] || funcao;
  }

  // ============================================================
  // Métodos para transferência de números entre clínicas
  // ============================================================

  /**
   * Inicia uma solicitação de transferência
   * @param {Object} params - Dados da transferência
   * @returns {Object} - { success, pendingTransfer }
   */
  async initiateTranfer({
    phoneToTransfer,
    newClinicId,
    newClinicName,
    newMemberData,
    requestedBy
  }) {
    const existingMember = await this.findMemberByPhone(phoneToTransfer);
    
    if (!existingMember) {
      return { success: false, error: 'Número não está vinculado a nenhuma clínica' };
    }
    
    // Encontra o telefone do dono/gestora da clínica atual
    const { data: primaryMember } = await supabase
      .from('clinic_members')
      .select('telefone, nome')
      .eq('clinic_id', existingMember.clinic_id)
      .eq('is_primary', true)
      .single();
    
    if (!primaryMember) {
      // Se não tem membro primário, busca o telefone do profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('telefone, nome_completo')
        .eq('id', existingMember.clinic_id)
        .single();
      
      if (profile) {
        primaryMember = {
          telefone: profile.telefone,
          nome: profile.nome_completo
        };
      }
    }
    
    if (!primaryMember) {
      return { success: false, error: 'Não foi possível encontrar o responsável da clínica atual' };
    }
    
    // Salva transferência pendente
    const transferId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const normalizedOwnerPhone = normalizePhone(primaryMember.telefone) || primaryMember.telefone;
    
    this.pendingTransfers.set(normalizedOwnerPhone, {
      id: transferId,
      phoneToTransfer,
      currentClinicId: existingMember.clinic_id,
      currentClinicName: existingMember.profiles?.nome_clinica,
      newClinicId,
      newClinicName,
      newMemberData,
      requestedBy,
      timestamp: Date.now()
    });
    
    return {
      success: true,
      pendingTransfer: {
        ownerPhone: normalizedOwnerPhone,
        ownerName: primaryMember.nome,
        phoneToTransfer,
        newClinicName
      }
    };
  }

  /**
   * Verifica se há transferência pendente para este telefone
   */
  hasPendingTransfer(phone) {
    const normalizedPhone = normalizePhone(phone) || phone;
    const transfer = this.pendingTransfers.get(normalizedPhone);
    
    // Expira após 24 horas
    if (transfer && Date.now() - transfer.timestamp > 24 * 60 * 60 * 1000) {
      this.pendingTransfers.delete(normalizedPhone);
      return false;
    }
    
    return !!transfer;
  }

  /**
   * Obtém detalhes da transferência pendente
   */
  getPendingTransfer(phone) {
    const normalizedPhone = normalizePhone(phone) || phone;
    return this.pendingTransfers.get(normalizedPhone);
  }

  /**
   * Aprova uma transferência pendente
   */
  async approveTransfer(ownerPhone) {
    const normalizedPhone = normalizePhone(ownerPhone) || ownerPhone;
    const transfer = this.pendingTransfers.get(normalizedPhone);
    
    if (!transfer) {
      return { success: false, error: 'Nenhuma transferência pendente encontrada' };
    }
    
    // Executa a transferência
    const result = await this.transferMember(
      transfer.phoneToTransfer,
      transfer.newClinicId,
      transfer.newMemberData
    );
    
    // Remove a transferência pendente
    this.pendingTransfers.delete(normalizedPhone);
    
    return result;
  }

  /**
   * Rejeita uma transferência pendente
   */
  rejectTransfer(ownerPhone) {
    const normalizedPhone = normalizePhone(ownerPhone) || ownerPhone;
    const transfer = this.pendingTransfers.get(normalizedPhone);
    
    if (!transfer) {
      return { success: false, error: 'Nenhuma transferência pendente encontrada' };
    }
    
    // Remove a transferência pendente
    this.pendingTransfers.delete(normalizedPhone);
    
    return { success: true, rejectedTransfer: transfer };
  }
}

module.exports = new ClinicMemberService();
