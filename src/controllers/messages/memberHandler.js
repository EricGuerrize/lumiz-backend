/**
 * Handler para gerenciamento de membros da clínica
 * Permite adicionar, listar e gerenciar números WhatsApp vinculados
 */

const clinicMemberService = require('../../services/clinicMemberService');
const onboardingCopy = require('../../copy/onboardingWhatsappCopy');
const conversationRuntimeStateService = require('../../services/conversationRuntimeStateService');
const { normalizePhone } = require('../../utils/phone');

class MemberHandler {
  constructor() {
    // Estado para fluxo de adição de membro
    this.addMemberStates = new Map();
    // Estado para fluxo de remoção de membro
    this.removeMemberStates = new Map();
    this.ADD_FLOW = 'member_add';
    this.REMOVE_FLOW = 'member_remove';
    this.TTL_MS = 10 * 60 * 1000;
  }

  async setAddMemberState(phone, state) {
    this.addMemberStates.set(phone, state);
    await conversationRuntimeStateService.upsert(phone, this.ADD_FLOW, state, this.TTL_MS);
  }

  async clearAddMemberState(phone) {
    this.addMemberStates.delete(phone);
    await conversationRuntimeStateService.clear(phone, this.ADD_FLOW);
  }

  async setRemoveMemberState(phone, state) {
    this.removeMemberStates.set(phone, state);
    await conversationRuntimeStateService.upsert(phone, this.REMOVE_FLOW, state, this.TTL_MS);
  }

  async clearRemoveMemberState(phone) {
    this.removeMemberStates.delete(phone);
    await conversationRuntimeStateService.clear(phone, this.REMOVE_FLOW);
  }

  restoreAddMemberState(phone, state) {
    if (!phone || !state) return;
    this.addMemberStates.set(phone, state);
  }

  restoreRemoveMemberState(phone, state) {
    if (!phone || !state) return;
    this.removeMemberStates.set(phone, state);
  }

  /**
   * Inicia o fluxo de adição de membro
   */
  async handleAddMember(user, phone) {
    const normalizedPhone = normalizePhone(phone) || phone;
    
    // Verifica se tem permissão
    const hasPermission = await clinicMemberService.hasAdminPermission(normalizedPhone);
    
    if (!hasPermission) {
      return onboardingCopy.addMemberNoPermission();
    }
    
    // Inicia estado de adição
    await this.setAddMemberState(normalizedPhone, {
      step: 'ROLE',
      clinicId: user.id,
      timestamp: Date.now()
    });
    
    return onboardingCopy.addMemberStart();
  }

  /**
   * Verifica se está em processo de adicionar membro
   */
  isAddingMember(phone) {
    const normalizedPhone = normalizePhone(phone) || phone;
    const state = this.addMemberStates.get(normalizedPhone);
    
    // Expira após 10 minutos
    if (state && Date.now() - state.timestamp > 10 * 60 * 1000) {
      void this.clearAddMemberState(normalizedPhone);
      return false;
    }
    
    return !!state;
  }

  /**
   * Processa mensagem no fluxo de adição de membro
   */
  async processAddMember(phone, message) {
    const normalizedPhone = normalizePhone(phone) || phone;
    const state = this.addMemberStates.get(normalizedPhone);
    
    if (!state) {
      return null;
    }
    
    const messageLower = message.toLowerCase().trim();
    
    // Permite cancelar
    if (['cancelar', 'sair', 'voltar'].includes(messageLower)) {
      await this.clearAddMemberState(normalizedPhone);
      return '❌ Cadastro cancelado.';
    }
    
    switch (state.step) {
      case 'ROLE':
        return await this.handleRole(normalizedPhone, messageLower, state);
        
      case 'NAME':
        return await this.handleName(normalizedPhone, message.trim(), state);
        
      case 'PHONE':
        return await this.handlePhone(normalizedPhone, message.trim(), state);
        
      default:
        await this.clearAddMemberState(normalizedPhone);
        return null;
    }
  }

  async handleRole(phone, messageLower, state) {
    const roleMap = {
      '1': 'dona',
      '2': 'adm',
      '3': 'secretaria',
      '4': 'profissional',
      'dona': 'dona',
      'gestora': 'dona',
      'adm': 'adm',
      'financeiro': 'adm',
      'secretaria': 'secretaria',
      'secretária': 'secretaria',
      'profissional': 'profissional'
    };
    
    const role = roleMap[messageLower];
    
    if (!role) {
      return '❓ Opção inválida. Escolha:\n\n1️⃣ Dona/Gestora\n2️⃣ Adm/Financeiro\n3️⃣ Secretária\n4️⃣ Profissional\n\nOu digite "cancelar" para sair.';
    }
    
    state.role = role;
    state.step = 'NAME';
    state.timestamp = Date.now();
    await this.setAddMemberState(phone, state);
    
    return onboardingCopy.addMemberNameQuestion();
  }

  async handleName(phone, name, state) {
    if (name.length < 2) {
      return 'Nome muito curto. Digite o nome completo da pessoa.';
    }
    
    state.name = name;
    state.step = 'PHONE';
    state.timestamp = Date.now();
    await this.setAddMemberState(phone, state);
    
    return onboardingCopy.addMemberPhoneQuestion();
  }

  async handlePhone(phone, memberPhone, state) {
    const normalizedMemberPhone = normalizePhone(memberPhone) || memberPhone;
    
    // Valida formato
    if (!/^\d{10,15}$/.test(normalizedMemberPhone.replace(/\D/g, ''))) {
      return onboardingCopy.profileAddMemberInvalidPhone();
    }
    
    // Tenta adicionar o membro
    const result = await clinicMemberService.addMember({
      clinicId: state.clinicId,
      telefone: normalizedMemberPhone,
      nome: state.name,
      funcao: state.role,
      createdBy: state.clinicId,
      isPrimary: false
    });
    
    // Limpa estado
    await this.clearAddMemberState(phone);
    
    if (!result.success) {
      if (result.error === 'PHONE_ALREADY_LINKED') {
        // Número já vinculado a outra clínica - por enquanto não permite transferência automática
        // Usuário deve pedir para o dono da outra clínica remover primeiro
        return onboardingCopy.addMemberPhoneAlreadyLinked(result.existingClinic?.nome_clinica || 'outra clínica');
      }
      return `❌ Erro ao cadastrar: ${result.error}`;
    }
    
    const roleName = clinicMemberService.getRoleName(state.role);
    return onboardingCopy.addMemberSuccess(state.name, roleName);
  }

  /**
   * Verifica se há transferência pendente para este telefone
   */
  hasPendingTransfer(phone) {
    return clinicMemberService.hasPendingTransfer(phone);
  }

  /**
   * Processa resposta de transferência
   */
  async processTransferResponse(phone, message) {
    const messageLower = message.toLowerCase().trim();
    
    const isApprove = messageLower === '1' || messageLower === 'sim' || 
                      messageLower.includes('pode transferir') || messageLower.includes('autorizo');
    const isDeny = messageLower === '2' || messageLower === 'não' || messageLower === 'nao' ||
                   messageLower.includes('manter');
    
    if (isApprove) {
      const result = await clinicMemberService.approveTransfer(phone);
      if (result.success) {
        return onboardingCopy.transferApproved();
      }
      return `❌ Erro ao aprovar transferência: ${result.error}`;
    }
    
    if (isDeny) {
      clinicMemberService.rejectTransfer(phone);
      return onboardingCopy.transferDenied();
    }
    
    // Se não entendeu, mostra a pergunta novamente
    const transfer = clinicMemberService.getPendingTransfer(phone);
    if (transfer) {
      return onboardingCopy.transferConfirmationToOwner(transfer.phoneToTransfer, transfer.newClinicName);
    }
    
    return null;
  }

  /**
   * Lista membros da clínica
   */
  async handleListMembers(user) {
    const members = await clinicMemberService.listMembers(user.id);
    
    if (!members || members.length === 0) {
      return '📱 Nenhum número adicional cadastrado.\n\nPara adicionar, diga: "cadastrar número"';
    }
    
    let response = '📱 *Números cadastrados na clínica:*\n\n';
    
    for (const member of members) {
      const status = member.confirmed ? '✅' : '⏳';
      const primary = member.is_primary ? ' (principal)' : '';
      const roleName = clinicMemberService.getRoleName(member.funcao);
      
      response += `${status} ${member.nome}${primary}\n`;
      response += `   📞 ${member.telefone}\n`;
      response += `   👤 ${roleName}\n\n`;
    }
    
    response += '_Para adicionar mais números, diga: "cadastrar número"_\n';
    response += '_Para remover algum número, diga: "remover número"_';

    return response;
  }

  /**
   * Inicia o fluxo de remoção de membro
   */
  async handleRemoveMember(user, phone) {
    const normalizedPhone = normalizePhone(phone) || phone;

    // Verifica se tem permissão
    const hasPermission = await clinicMemberService.hasAdminPermission(normalizedPhone);

    if (!hasPermission) {
      return onboardingCopy.removeMemberNoPermission();
    }

    // Busca membros da clínica
    const members = await clinicMemberService.listMembers(user.id);

    if (!members || members.length === 0) {
      return '📱 Não há números cadastrados para remover.';
    }

    // Filtra membros que podem ser removidos (não primários)
    const removableMembers = members.filter(m => !m.is_primary);

    if (removableMembers.length === 0) {
      return '⚠️ Não há números que possam ser removidos.\n\nO número principal da clínica não pode ser removido.';
    }

    // Inicia estado de remoção
    await this.setRemoveMemberState(normalizedPhone, {
      step: 'SELECT',
      clinicId: user.id,
      members: removableMembers,
      timestamp: Date.now()
    });

    // Monta lista de membros para seleção
    let response = '🗑️ *Qual número deseja remover?*\n\n';

    removableMembers.forEach((member, index) => {
      const roleName = clinicMemberService.getRoleName(member.funcao);
      response += `${index + 1}️⃣ ${member.nome}\n`;
      response += `   📞 ${member.telefone}\n`;
      response += `   👤 ${roleName}\n\n`;
    });

    response += `Digite o número da opção (1-${removableMembers.length})\n`;
    response += `Ou digite "cancelar" para sair.`;

    return response;
  }

  /**
   * Verifica se está em processo de remover membro
   */
  isRemovingMember(phone) {
    const normalizedPhone = normalizePhone(phone) || phone;
    const state = this.removeMemberStates.get(normalizedPhone);

    // Expira após 10 minutos
    if (state && Date.now() - state.timestamp > 10 * 60 * 1000) {
      void this.clearRemoveMemberState(normalizedPhone);
      return false;
    }

    return !!state;
  }

  /**
   * Processa mensagem no fluxo de remoção de membro
   */
  async processRemoveMember(phone, message) {
    const normalizedPhone = normalizePhone(phone) || phone;
    const state = this.removeMemberStates.get(normalizedPhone);

    if (!state) {
      return null;
    }

    const messageLower = message.toLowerCase().trim();

    // Permite cancelar
    if (['cancelar', 'sair', 'voltar'].includes(messageLower)) {
      await this.clearRemoveMemberState(normalizedPhone);
      return '❌ Remoção cancelada.';
    }

    if (state.step === 'SELECT') {
      // Verifica se é um número válido
      const selection = parseInt(message.trim(), 10);

      if (isNaN(selection) || selection < 1 || selection > state.members.length) {
        return `❓ Opção inválida. Digite um número de 1 a ${state.members.length}, ou "cancelar" para sair.`;
      }

      const selectedMember = state.members[selection - 1];
      state.selectedMember = selectedMember;
      state.step = 'CONFIRM';
      state.timestamp = Date.now();
      await this.setRemoveMemberState(normalizedPhone, state);

      return onboardingCopy.removeMemberConfirmation(selectedMember.nome, selectedMember.telefone);
    }

    if (state.step === 'CONFIRM') {
      const isYes = messageLower === '1' || messageLower === 'sim' || messageLower.includes('confirmo');
      const isNo = messageLower === '2' || messageLower === 'não' || messageLower === 'nao';

      if (isYes) {
        // Remove o membro
        const result = await clinicMemberService.removeMember(state.selectedMember.id, normalizedPhone);

        await this.clearRemoveMemberState(normalizedPhone);

        if (result.success) {
          return onboardingCopy.removeMemberSuccess(state.selectedMember.nome);
        } else {
          return `❌ Erro ao remover: ${result.error}`;
        }
      }

      if (isNo) {
        await this.clearRemoveMemberState(normalizedPhone);
        return '❌ Remoção cancelada.';
      }

      return onboardingCopy.removeMemberConfirmation(state.selectedMember.nome, state.selectedMember.telefone);
    }

    return null;
  }
}

module.exports = MemberHandler;
