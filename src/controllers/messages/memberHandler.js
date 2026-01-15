/**
 * Handler para gerenciamento de membros da clínica
 * Permite adicionar, listar e gerenciar números WhatsApp vinculados
 */

const clinicMemberService = require('../../services/clinicMemberService');
const onboardingCopy = require('../../copy/onboardingWhatsappCopy');
const { normalizePhone } = require('../../utils/phone');

class MemberHandler {
  constructor() {
    // Estado para fluxo de adição de membro
    this.addMemberStates = new Map();
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
    this.addMemberStates.set(normalizedPhone, {
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
      this.addMemberStates.delete(normalizedPhone);
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
      this.addMemberStates.delete(normalizedPhone);
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
        this.addMemberStates.delete(normalizedPhone);
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
    this.addMemberStates.set(phone, state);
    
    return onboardingCopy.addMemberNameQuestion();
  }

  async handleName(phone, name, state) {
    if (name.length < 2) {
      return 'Nome muito curto. Digite o nome completo da pessoa.';
    }
    
    state.name = name;
    state.step = 'PHONE';
    state.timestamp = Date.now();
    this.addMemberStates.set(phone, state);
    
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
    this.addMemberStates.delete(phone);
    
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
    
    response += '_Para adicionar mais números, diga: "cadastrar número"_';
    
    return response;
  }
}

module.exports = MemberHandler;
