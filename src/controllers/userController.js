const supabase = require('../db/supabase');
const onboardingService = require('../services/onboardingService');
const emailService = require('../services/emailService');
const registrationTokenService = require('../services/registrationTokenService');

class UserController {
  constructor() {
    // Armazena dados de onboarding em andamento
    this.onboardingData = new Map();
  }

  maskCnpj(cnpj) {
    if (!cnpj) return null;
    return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }

  normalizeTeamRange(input) {
    if (!input) return null;
    const normalized = input.toString().trim().toLowerCase();

    const map = {
      '1': '1-5',
      '2': '6-10',
      '3': '11-20',
      '4': '20+',
      '1-5': '1-5',
      '1 a 5': '1-5',
      '6-10': '6-10',
      '6 a 10': '6-10',
      '11-20': '11-20',
      '11 a 20': '11-20',
      '20+': '20+',
      '20 +': '20+',
      '20 ou mais': '20+'
    };

    if (map[normalized]) {
      return map[normalized];
    }

    const number = parseInt(normalized, 10);
    if (Number.isNaN(number)) {
      return null;
    }
    if (number <= 5) return '1-5';
    if (number <= 10) return '6-10';
    if (number <= 20) return '11-20';
    return '20+';
  }

  normalizeVolumeRange(input) {
    if (!input) return null;
    const normalized = input.toString().trim().toLowerCase();

    const map = {
      '1': 'até 30',
      '2': '30-60',
      '3': '60-100',
      '4': '100+',
      'ate 30': 'até 30',
      'até 30': 'até 30',
      '30-60': '30-60',
      '60-100': '60-100',
      '100+': '100+',
      '100 +': '100+',
      '100 ou mais': '100+'
    };

    if (map[normalized]) {
      return map[normalized];
    }

    const number = parseInt(normalized, 10);
    if (Number.isNaN(number)) {
      return null;
    }
    if (number <= 30) return 'até 30';
    if (number <= 60) return '30-60';
    if (number <= 100) return '60-100';
    return '100+';
  }

  normalizeMdrChoice(input) {
    if (!input) return null;
    const normalized = input.toString().trim().toLowerCase();

    if (normalized === '1' || normalized.includes('configurar')) {
      return 'configurar_agora';
    }
    if (normalized === '2' || normalized.includes('lembrar')) {
      return 'lembrar_mais_tarde';
    }
    if (normalized === '3' || normalized.includes('nao uso') || normalized.includes('não uso')) {
      return 'nao_usa_maquininha';
    }
    return null;
  }

  getMdrChoiceMessage(choice) {
    switch (choice) {
      case 'configurar_agora':
        return 'Perfeito! Assim que finalizarmos, você pode cadastrar as taxas me enviando um print da maquininha que eu leio via OCR.';
      case 'lembrar_mais_tarde':
        return 'Sem problemas! Vou deixar anotado para te lembrar em outro momento.';
      case 'nao_usa_maquininha':
        return 'Tudo bem! Vou marcar aqui que você não utiliza maquininha/cartão.';
      default:
        return '';
    }
  }

  humanizeMdrChoice(choice) {
    switch (choice) {
      case 'configurar_agora':
        return 'Vai configurar agora';
      case 'lembrar_mais_tarde':
        return 'Lembrar mais tarde';
      case 'nao_usa_maquininha':
        return 'Não usa maquininha';
      default:
        return 'Não informado';
    }
  }

  async buildConfirmationMessage(phone, onboarding) {
    const linhas = [
      `👤 *Nome:* ${onboarding.data.nome_completo}`,
      `🏥 *Clínica:* ${onboarding.data.nome_clinica}`,
      `📱 *WhatsApp:* ${phone}`,
      `🧾 *CNPJ:* ${
        onboarding.data.cnpj
          ? this.maskCnpj(onboarding.data.cnpj)
          : onboarding.data.cnpj_status === 'skipped'
            ? 'Prefere informar depois'
            : 'Não informado'
      }`,
      `👥 *Equipe:* ${onboarding.data.team_size_range || 'Não informado'}`,
      `📈 *Volume mensal:* ${onboarding.data.volume_range || 'Não informado'}`,
      `💳 *Taxas MDR:* ${this.humanizeMdrChoice(onboarding.data.mdr_choice)}`
    ];

    const progressLabel = await onboardingService.getProgressLabel(phone);
    const progressText = progressLabel ? `\n${progressLabel}\n` : '';

    return `Perfeito! Confirma os dados antes de criar sua conta:\n\n${linhas.join('\n')}\n${progressText}\nTá tudo certo? Responde *SIM* pra criar ou *NÃO* pra ajustar.`;
  }

  async findUserByPhone(phone) {
    try {
      // Busca na tabela profiles pelo telefone
      const { data: existingUser, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('telefone', phone)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        // PGRST116 = não encontrado, outros erros são problemas reais
        throw fetchError;
      }

      return existingUser || null;
    } catch (error) {
      console.error('Erro ao buscar usuário:', error);
      throw error;
    }
  }

  isOnboarding(phone) {
    return this.onboardingData.has(phone);
  }

  getOnboardingStep(phone) {
    const data = this.onboardingData.get(phone);
    return data ? data.step : null;
  }

  /**
   * Verifica se usuário já interagiu antes (usuário antigo)
   */
  async isReturningUser(phone) {
    try {
      // Verifica se existe onboarding_progress anterior
      const { data: existingOnboarding } = await supabase
        .from('onboarding_progress')
        .select('id, created_at')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Se existe onboarding anterior (mesmo que incompleto), é usuário antigo
      return !!existingOnboarding;
    } catch (error) {
      console.error('[ONBOARDING] Erro ao verificar usuário antigo:', error);
      return false;
    }
  }

  async startOnboarding(phone, isReturningUser = false) {
    // Nova ordem: clínica primeiro
    this.onboardingData.set(phone, {
      step: 'nome_clinica',
      data: {
        telefone: phone,
        is_returning_user: isReturningUser
      },
      timestamp: Date.now()
    });

    try {
      await onboardingService.ensureState(phone, null, {
        stage: 'phase1',
        channel: 'whatsapp',
        abVariant: 'whatsapp_v2' // Nova versão do fluxo
      });
      await onboardingService.updateStepStatus(phone, 'phase1_welcome', 'completed', {
        channel: 'whatsapp'
      });
    } catch (error) {
      console.error('Erro ao iniciar progresso de onboarding:', error);
    }
  }

  async processOnboarding(phone, message) {
    const onboarding = this.onboardingData.get(phone);
    if (!onboarding) return null;

    const messageTrimmed = message.trim();

    switch (onboarding.step) {
      // NOVA ORDEM: Clínica primeiro
      case 'nome_clinica': {
        if (messageTrimmed.length < 2) {
          return 'Por favor, digite o nome da clínica.';
        }
        onboarding.data.nome_clinica = messageTrimmed;
        onboarding.step = 'nome_completo'; // Agora nome vem depois da clínica

        try {
          await onboardingService.savePhaseData(phone, 'phase1', {
            clinic_name: messageTrimmed
          });
          await onboardingService.updateStepStatus(phone, 'phase1_clinic', 'completed', {
            value: messageTrimmed
          });
        } catch (error) {
          console.error('Erro ao salvar progresso (clínica):', error);
        }

        return `Perfeito! 😄\n\n*E qual o seu nome mesmo? Vou te chamar direitinho aqui 😉*`;
      }

      // Nome completo agora é segundo
      case 'nome_completo': {
        if (messageTrimmed.length < 3) {
          return 'Por favor, digite seu nome completo (mínimo 3 caracteres).';
        }
        onboarding.data.nome_completo = messageTrimmed;
        onboarding.step = 'perfil_usuario'; // Novo step

        try {
          await onboardingService.savePhaseData(phone, 'phase1', {
            contact_name: messageTrimmed
          });
          await onboardingService.updateStepStatus(phone, 'phase1_name', 'completed', {
            value: messageTrimmed
          });
        } catch (error) {
          console.error('Erro ao salvar progresso (nome):', error);
        }

        return `Prazer, ${messageTrimmed.split(' ')[0]}! 😊\n\n*Você é:\n\n1. Proprietária(o) da clínica\n2. Gestora(o)\n3. Recepcionista\n4. Outra função?*`;
      }

      // NOVO: Perfil do usuário
      case 'perfil_usuario': {
        const perfilMap = {
          '1': 'proprietaria',
          '2': 'gestora',
          '3': 'recepcionista',
          '4': 'outra',
          'proprietária': 'proprietaria',
          'proprietario': 'proprietaria',
          'gestora': 'gestora',
          'gestor': 'gestora',
          'recepcionista': 'recepcionista',
          'outra': 'outra'
        };
        
        const perfilLower = messageTrimmed.toLowerCase().trim();
        const perfil = perfilMap[perfilLower] || (perfilMap[perfilLower.split(' ')[0]] || null);

        if (!perfil) {
          return 'Por favor, escolha uma opção:\n1. Proprietária(o)\n2. Gestora(o)\n3. Recepcionista\n4. Outra função';
        }

        onboarding.data.perfil_usuario = perfil;
        onboarding.step = 'formas_pagamento'; // Novo step

        try {
          await onboardingService.savePhaseData(phone, 'phase1', {
            perfil_usuario: perfil
          });
        } catch (error) {
          console.error('Erro ao salvar perfil:', error);
        }

        // Envia botões para formas de pagamento
        const evolutionService = require('../services/evolutionService');
        try {
          const buttonResult = await evolutionService.sendButtons(
            phone,
            '*Hoje você recebe como? (Pode marcar mais de uma)*',
            ['PIX', 'Cartão', 'Dinheiro', 'Link de pagamento', 'Outros']
          );
          
          // Se os botões foram enviados com sucesso, retorna null para não enviar mensagem adicional
          if (buttonResult) {
            return null;
          } else {
            // Se falhou, envia como texto
            return '*Hoje você recebe como? (Pode marcar mais de uma)*\n\n• PIX\n• Cartão\n• Dinheiro\n• Link de pagamento\n• Outros\n\nDigite as opções separadas por vírgula (ex: "PIX, Cartão").';
          }
        } catch (error) {
          console.error('Erro ao enviar botões de formas de pagamento:', error);
          // Fallback: envia como texto
          return '*Hoje você recebe como? (Pode marcar mais de uma)*\n\n• PIX\n• Cartão\n• Dinheiro\n• Link de pagamento\n• Outros\n\nDigite as opções separadas por vírgula (ex: "PIX, Cartão").';
        }
      }

      // NOVO: Formas de pagamento (múltipla escolha)
      case 'formas_pagamento': {
        const formas = [];
        const formasMap = {
          'pix': 'pix',
          'cartão': 'cartao',
          'cartao': 'cartao',
          'dinheiro': 'dinheiro',
          'link de pagamento': 'link_pagamento',
          'link': 'link_pagamento',
          'outros': 'outros',
          'outro': 'outros'
        };

        // Pode receber múltiplas respostas (botões ou texto)
        const partes = messageTrimmed.toLowerCase().split(/[,\s]+/);
        partes.forEach(parte => {
          const parteTrim = parte.trim();
          if (formasMap[parteTrim]) {
            formas.push(formasMap[parteTrim]);
          }
        });

        // Se não encontrou nenhuma, tenta buscar no texto completo
        if (formas.length === 0) {
          for (const [key, value] of Object.entries(formasMap)) {
            if (messageTrimmed.toLowerCase().includes(key)) {
              formas.push(value);
            }
          }
        }

        if (formas.length === 0) {
          return 'Por favor, escolha pelo menos uma forma de pagamento:\n• PIX\n• Cartão\n• Dinheiro\n• Link de pagamento\n• Outros';
        }

        onboarding.data.formas_pagamento = formas;
        onboarding.step = 'volume_vendas'; // Ajustado nome

        try {
          await onboardingService.savePhaseData(phone, 'phase1', {
            formas_pagamento: formas
          });
        } catch (error) {
          console.error('Erro ao salvar formas de pagamento:', error);
        }

        return `Ótimo! Já anotei suas formas de pagamento. 💜\n\n*Em média, quantas vendas você faz por mês?*`;
      }

      // Volume de vendas (ajustado)
      case 'volume_vendas': {
        // Aceita número direto ou texto
        const numero = parseInt(messageTrimmed.replace(/\D/g, ''), 10);
        
        if (isNaN(numero) || numero <= 0) {
          return 'Por favor, me diga quantas vendas você faz por mês (pode ser um número aproximado).';
        }

        onboarding.data.volume_vendas = numero;
        onboarding.step = 'momento_wow'; // Novo step - momento WOW

        try {
          await onboardingService.savePhaseData(phone, 'phase1', {
            volume_vendas: numero,
            volume_status: 'provided'
          });
          await onboardingService.updateStepStatus(
            phone,
            'phase1_volume',
            'completed',
            { value: numero }
          );
        } catch (error) {
          console.error('Erro ao salvar volume de vendas:', error);
        }

        return `Ótimo, já entendi seu tamanho. Isso vai me ajudar a te entregar relatórios melhores.\n\n*Agora vamos fazer seu primeiro teste rápido 😄\n\nMe envie uma venda da sua clínica, do jeitinho que você falaria para um amigo.*\n\n*Exemplo:*\n"Júlia fez um full face com 12ml, usamos 10 Biogelis volume e 1 Juvederm. Total 15.600, pagou 3.000 no PIX e o resto em 6x no cartão."\n\nEu entendo tudo automaticamente.`;
      }

      // NOVO: Momento WOW - esperando primeira venda
      case 'momento_wow': {
        // Processa a venda usando o messageController
        const geminiService = require('../services/geminiService');
        const intent = await geminiService.processMessage(messageTrimmed);

        if (intent.intencao === 'registrar_entrada') {
          // Venda foi processada, agora pede custo
          onboarding.data.primeira_venda = intent.dados;
          onboarding.step = 'pedir_custo_variavel';

          // Salva a venda temporariamente (será confirmada depois)
          onboarding.data.venda_pendente = intent.dados;

          return `Entrada registrada! 🟣\n\nAgora que já sei quanto entrou, bora ver o outro lado do financeiro?\n\nMe envie agora um custo da sua clínica — pode ser algo simples como uma compra de insumo, produto ou maquininha.\n\nSe quiser, pode mandar foto do boleto, PDF, nota fiscal ou até um texto.`;
        } else {
          // Não entendeu como venda, pede novamente
          return `Não entendi bem como uma venda 🤔\n\nMe manda assim:\n"Júlia fez um full face com 12ml, usamos 10 Biogelis volume e 1 Juvederm. Total 15.600, pagou 3.000 no PIX e o resto em 6x no cartão."\n\nOu mais simples: "Botox 2800 paciente Maria"`;
        }
      }

      // NOVO: Pedir custo variável
      case 'pedir_custo_variavel': {
        // Verifica se é um intent JSON (vindo de processamento de imagem)
        let intent;
        try {
          const parsed = JSON.parse(messageTrimmed);
          if (parsed.intencao && parsed.dados) {
            intent = parsed;
          } else {
            throw new Error('Not a valid intent');
          }
        } catch (e) {
          // Não é JSON, processa como mensagem normal
          const geminiService = require('../services/geminiService');
          intent = await geminiService.processMessage(messageTrimmed);
        }

        if (intent.intencao === 'registrar_saida' || intent.intencao === 'enviar_documento') {
          // Processou um custo, agora precisa classificar
          onboarding.data.custo_pendente = intent.dados;
          onboarding.step = 'classificar_custo';

          // Extrai informações do custo
          const descricao = intent.dados?.categoria || intent.dados?.descricao || 'Custo';
          const valor = intent.dados?.valor || 0;
          const quantidade = intent.dados?.quantidade || '';
          const formaPagamento = intent.dados?.forma_pagamento || 'Não especificado';

          let response = `Show! Aqui está o que registrei:\n\n`;
          response += `• Descrição: ${descricao}\n`;
          if (quantidade) response += `• Quantidade: ${quantidade}\n`;
          response += `• Valor: R$ ${valor.toFixed(2)}\n`;
          response += `• Pagamento: ${formaPagamento}\n`;
          response += `• Categoria sugerida: Compra de insumo\n\n`;
          response += `*Agora me diz: esse custo é fixo ou variável?*`;

          // Envia opções como texto (simulando botões)
          response += '\n\nResponda: "Variável" ou "Fixo"';
          return response;
        } else {
          return `Não entendi como um custo 🤔\n\nMe manda algo como:\n"Comprei 6 frascos de Biogeli, paguei 1.800 no cartão"\n\nOu envie foto de boleto/nota fiscal.`;
        }
      }

      // NOVO: Classificar custo (fixo/variável)
      case 'classificar_custo': {
        const messageLower = messageTrimmed.toLowerCase();
        const isVariavel = messageLower.includes('variável') || messageLower.includes('variavel') || messageLower.includes('📦');
        const isFixo = messageLower.includes('fixo') || messageLower.includes('🏠') || messageLower.includes('todo mês');

        if (!isVariavel && !isFixo) {
          return 'Por favor, escolha uma opção:\n📦 Variável (depende dos procedimentos)\n🏠 Fixo (todo mês)';
        }

        const tipoCusto = isVariavel ? 'variavel' : 'fixo';
        onboarding.data.custo_pendente.tipo_custo = tipoCusto;
        onboarding.data.custos_registrados = onboarding.data.custos_registrados || [];
        onboarding.data.custos_registrados.push({
          ...onboarding.data.custo_pendente,
          tipo_custo: tipoCusto
        });

        if (isVariavel) {
          // Custo variável registrado, agora pede custo fixo
          onboarding.step = 'pedir_custo_fixo';
          return `Perfeito! Lancei como custo variável.\n\nIsso me ajuda a calcular suas análises com mais precisão 💜\n\n*Agora falta só um custo fixo pra completar o seu painel inicial.\n\nMe envie algo como aluguel, software, salário, internet… o que for mais fácil pra você.*`;
        } else {
          // Custo fixo registrado, mas ainda precisa do variável
          if (!onboarding.data.custos_registrados.some(c => c.tipo_custo === 'variavel')) {
            onboarding.step = 'pedir_custo_variavel';
            return `Perfeito! Lancei como custo fixo.\n\n*Agora me envie um custo variável (como compra de insumos, produtos, etc).*`;
          } else {
            // Já tem ambos, pode mostrar resumo
            onboarding.step = 'resumo_final';
            return await this.showResumoFinal(phone, onboarding);
          }
        }
      }

      // NOVO: Pedir custo fixo
      case 'pedir_custo_fixo': {
        // Verifica se é um intent JSON (vindo de processamento de imagem)
        let intent;
        try {
          const parsed = JSON.parse(messageTrimmed);
          if (parsed.intencao && parsed.dados) {
            intent = parsed;
          } else {
            throw new Error('Not a valid intent');
          }
        } catch (e) {
          // Não é JSON, processa como mensagem normal
          const geminiService = require('../services/geminiService');
          intent = await geminiService.processMessage(messageTrimmed);
        }

        if (intent.intencao === 'registrar_saida' || intent.intencao === 'enviar_documento') {
          onboarding.data.custo_pendente = intent.dados;
          onboarding.data.custo_pendente.tipo_custo = 'fixo';
          onboarding.data.custos_registrados = onboarding.data.custos_registrados || [];
          onboarding.data.custos_registrados.push(onboarding.data.custo_pendente);

          const descricao = intent.dados?.categoria || intent.dados?.descricao || 'Custo fixo';
          const valor = intent.dados?.valor || 0;
          const formaPagamento = intent.dados?.forma_pagamento || 'PIX';

          onboarding.step = 'resumo_final';

          return `Boa! Peguei aqui:\n\n• ${descricao} — R$ ${valor.toFixed(2)}\n• Pagamento: ${formaPagamento}\n\nLançar como custo fixo mensal?\n\n*Responda "sim" para confirmar.*`;
        } else {
          return `Não entendi como um custo fixo 🤔\n\nMe manda algo como:\n"Aluguel 5.000"\n\nOu envie foto de boleto/nota fiscal.`;
        }
      }

      // NOVO: Resumo final
      case 'resumo_final': {
        const messageLower = messageTrimmed.toLowerCase();
        if (messageLower.includes('sim') || messageLower.includes('confirmar') || messageLower.includes('ok')) {
          return await this.showResumoFinal(phone, onboarding);
        } else {
          return 'Por favor, confirme com "sim" para ver o resumo final.';
        }
      }

      // CASES ANTIGOS (mantidos para compatibilidade, mas não serão usados no novo fluxo)
      case 'cnpj': {
        const digits = messageTrimmed.replace(/\D/g, '');
        const skip = onboardingService.isSkipResponse(messageTrimmed.toLowerCase());

        if (skip) {
          onboarding.data.cnpj_status = 'skipped';
        } else {
          if (digits.length !== 14) {
            return 'O CNPJ precisa ter 14 dígitos. Se preferir, responda *Pular*.';
          }
          onboarding.data.cnpj = digits;
          onboarding.data.cnpj_status = 'provided';
        }

        onboarding.step = 'numero_funcionarios';

        try {
          await onboardingService.savePhaseData(phone, 'phase1', {
            cnpj: onboarding.data.cnpj || null,
            cnpj_status: onboarding.data.cnpj_status
          });
          await onboardingService.updateStepStatus(
            phone,
            'phase1_cnpj',
            skip ? 'skipped' : 'completed',
            {
              masked: onboarding.data.cnpj ? this.maskCnpj(onboarding.data.cnpj) : 'skipped'
            }
          );
        } catch (error) {
          console.error('Erro ao salvar CNPJ:', error);
        }

        const progressLabel = await onboardingService.getProgressLabel(phone);
        const progressText = progressLabel ? `\n\n${progressLabel}` : '';

        return `Show!${progressText}\n\nAgora me conta: *quantas pessoas trabalham com você hoje?*\n\nEscolhe uma opção:\n1️⃣ 1-5 pessoas\n2️⃣ 6-10 pessoas\n3️⃣ 11-20 pessoas\n4️⃣ 20+ pessoas\n\nSe preferir, responde com o número ou digita *Pular*.`;
      }

      case 'numero_funcionarios': {
        const skip = onboardingService.isSkipResponse(messageTrimmed.toLowerCase());
        const range = skip ? null : this.normalizeTeamRange(messageTrimmed);

        if (!range && !skip) {
          return 'Me envia apenas um número ou uma das opções: 1-5, 6-10, 11-20, 20+. Ou digita *Pular*.';
        }

        onboarding.data.team_size_range = range;
        onboarding.step = 'volume_mensal';

        try {
          await onboardingService.savePhaseData(phone, 'phase1', {
            team_size_range: range,
            team_size_status: skip ? 'skipped' : 'provided'
          });
          await onboardingService.updateStepStatus(
            phone,
            'phase1_team_size',
            skip ? 'skipped' : 'completed',
            { value: range || 'skipped' }
          );
        } catch (error) {
          console.error('Erro ao salvar número de funcionários:', error);
        }

        const progressLabel = await onboardingService.getProgressLabel(phone);
        const progressText = progressLabel ? `\n\n${progressLabel}` : '';

        return `Perfeito!${progressText}\n\nE qual é o *volume mensal de atendimentos/pacientes*? Pode mandar uma faixa:\n• até 30\n• 30-60\n• 60-100\n• 100+\n\nOu digita *Prefiro não informar agora*.`;
      }

      case 'volume_mensal': {
        const skip = onboardingService.isSkipResponse(messageTrimmed.toLowerCase());
        const volumeRange = skip ? null : this.normalizeVolumeRange(messageTrimmed);

        if (!volumeRange && !skip) {
          return 'Manda uma faixa aproximada: até 30, 30-60, 60-100, 100+. Ou digita *Pular*.';
        }

        onboarding.data.volume_range = volumeRange;
        onboarding.step = 'mdr_pergunta';

        try {
          await onboardingService.savePhaseData(phone, 'phase1', {
            volume_range: volumeRange,
            volume_status: skip ? 'skipped' : 'provided'
          });
          await onboardingService.updateStepStatus(
            phone,
            'phase1_volume',
            skip ? 'skipped' : 'completed',
            { value: volumeRange || 'skipped' }
          );
          await onboardingService.updateState(phone, {
            stage: 'phase2',
            phase: 2
          });
        } catch (error) {
          console.error('Erro ao salvar volume mensal:', error);
        }

        const progressLabel = await onboardingService.getProgressLabel(phone);
        const progressText = progressLabel ? `\n\n${progressLabel}` : '';

        return `Top!${progressText}\n\nAgora me diz:\n\n*Vamos cadastrar as taxas da sua maquininha? Assim automatizamos os cálculos pra você.*\n\nResponda com uma opção:\n1️⃣ Configurar agora (leva ~3 minutos)\n2️⃣ Lembrar mais tarde\n3️⃣ Não uso maquininha/cartão`;
      }

      case 'mdr_pergunta': {
        const choice = this.normalizeMdrChoice(messageTrimmed);

        if (!choice) {
          return 'Responda 1 para configurar agora, 2 para lembrar depois ou 3 se não usa maquininha.';
        }

        onboarding.data.mdr_choice = choice;
        onboarding.step = 'confirmacao';

        try {
          await onboardingService.savePhaseData(phone, 'phase2', {
            question_choice: choice,
            mdr_status: choice === 'configurar_agora' ? 'pending' : 'opt_out'
          });
          await onboardingService.updateStepStatus(phone, 'phase2_mdr_question', 'completed', {
            choice
          });
        } catch (error) {
          console.error('Erro ao salvar escolha de MDR:', error);
        }

        const instructions = this.getMdrChoiceMessage(choice);
        const confirmationMessage = await this.buildConfirmationMessage(phone, onboarding);

        return `${instructions}\n\n${confirmationMessage}`;
      }

      case 'confirmacao':
        const resposta = messageTrimmed.toLowerCase();

        if (resposta === 'sim' || resposta === 's' || resposta === 'confirmar' || resposta === 'ok') {
          // Finaliza o cadastro
          try {
            const result = await this.createUserFromOnboarding(onboarding.data);
            this.onboardingData.delete(phone);

            // Cria procedimentos padrão
            await this.createDefaultProcedimentos(result.user.id);

             try {
               await onboardingService.updateState(phone, {
                 userId: result.user.id,
                 stage: 'phase3',
                 phase: 3,
                 data: {
                   phase3: {
                     onboarding_completed_at: new Date().toISOString(),
                     assistant_persona: 'lumiz_whatsapp'
                   }
                 }
               });
               await onboardingService.updateStepStatus(phone, 'phase3_whatsapp', 'completed', {
                 channel: 'whatsapp'
               });
               await onboardingService.markCompleted(phone);
             } catch (progressError) {
               console.error('Erro ao finalizar progresso do onboarding:', progressError);
             }

            let response;

            // Mensagem final do onboarding - envia link de cadastro
            response = `*CADASTRO BÁSICO CONCLUÍDO!*\n\n` +
                      `Ótimo! Já coletei suas informações básicas. Agora falta só uma última etapa para você ter acesso completo.\n\n` +
                      `*CADASTRE-SE*\n\n` +
                      `Clique no link abaixo para criar sua conta:\n\n` +
                      `${result.registrationLink}\n\n` +
                      `*O que acontece quando você se cadastrar:*\n` +
                      `• Seu email será vinculado ao seu WhatsApp\n` +
                      `• Você terá acesso completo a todos os recursos\n` +
                      `• Todas as transações do WhatsApp ficarão sincronizadas\n\n` +
                      `*Importante:*\n` +
                      `• O link é válido por 48 horas\n` +
                      `• Você pode continuar usando o WhatsApp normalmente enquanto isso\n\n` +
                      `Assim que finalizar o cadastro, eu te aviso aqui no WhatsApp! 😊`;

            response += `*Pronto pra começar?* 🚀\n\n` +
                   `Me manda sua primeira venda assim:\n` +
                   `_"Botox 2800 paciente Maria"_\n\n` +
                   `Ou manda "ajuda" que te mostro tudo que sei fazer! 😊`;

            return response;
          } catch (error) {
            console.error('Erro ao criar usuário:', error);
            this.onboardingData.delete(phone);
            return `Erro ao criar cadastro 😢\n\n${error.message}\n\nTente novamente enviando qualquer mensagem.`;
          }
        } else if (resposta === 'não' || resposta === 'nao' || resposta === 'n' || resposta === 'recomeçar') {
          await this.startOnboarding(phone);
          return `Ok, vamos recomeçar! 😊\n\n*Qual o seu nome completo?*`;
        } else {
          return `Não entendi... Responde *SIM* pra confirmar ou *NÃO* pra recomeçar`;
        }

      default:
        this.onboardingData.delete(phone);
        return 'Algo deu errado no cadastro. Envie qualquer mensagem para recomeçar.';
    }
  }

  /**
   * Mostra resumo final do teste (SEM calcular margem)
   */
  async showResumoFinal(phone, onboarding) {
    try {
      const venda = onboarding.data.venda_pendente || onboarding.data.primeira_venda;
      const custos = onboarding.data.custos_registrados || [];

      const receita = venda?.valor || 0;
      const custosVariaveis = custos.filter(c => c.tipo_custo === 'variavel').reduce((sum, c) => sum + (c.valor || 0), 0);
      const custosFixos = custos.filter(c => c.tipo_custo === 'fixo').reduce((sum, c) => sum + (c.valor || 0), 0);
      const saldoInicial = receita - custosVariaveis - custosFixos;

      let response = `Perfeito! Já organizei suas três primeiras informações 🎉\n\n`;
      response += `*Aqui vai um resumo inicial, só para você ver como tudo começa a tomar forma:*\n\n`;
      response += `📊 *Primeiros dados da sua clínica*\n\n`;
      response += `• Receita cadastrada: R$ ${receita.toFixed(2)}\n`;
      response += `• Custos do mês (parciais):\n`;
      response += `  • Custos variáveis registrados: R$ ${custosVariaveis.toFixed(2)}\n`;
      response += `  • Custos fixos registrados: R$ ${custosFixos.toFixed(2)}\n`;
      response += `• Saldo inicial: R$ ${saldoInicial.toFixed(2)}\n`;
      response += `_(Esse valor muda rápido conforme você registra suas vendas e custos reais.)_\n\n`;
      response += `Com mais dados, te mostro gráficos, histórico, totais, projeções e muito mais — tudo automaticamente 💜\n\n`;

      // Finaliza onboarding e cria usuário
      const result = await this.createUserFromOnboarding(onboarding.data);
      this.onboardingData.delete(phone);

      // Cria procedimentos padrão
      await this.createDefaultProcedimentos(result.user.id);

      try {
        await onboardingService.updateState(phone, {
          userId: result.user.id,
          stage: 'phase3',
          phase: 3,
          data: {
            phase3: {
              onboarding_completed_at: new Date().toISOString(),
              assistant_persona: 'lumiz_whatsapp'
            }
          }
        });
        await onboardingService.updateStepStatus(phone, 'phase3_whatsapp', 'completed', {
          channel: 'whatsapp'
        });
        await onboardingService.markCompleted(phone);
      } catch (progressError) {
        console.error('Erro ao finalizar progresso do onboarding:', progressError);
      }

      // Registra a venda e custos no banco
      if (venda) {
        const transactionController = require('./transactionController');
        try {
          await transactionController.createTransaction(result.user.id, {
            tipo: 'entrada',
            valor: venda.valor,
            categoria: venda.categoria || 'Procedimento',
            descricao: venda.descricao || venda.nome_cliente || '',
            data: venda.data || new Date().toISOString().split('T')[0],
            forma_pagamento: venda.forma_pagamento || 'avista',
            parcelas: venda.parcelas || null,
            bandeira_cartao: venda.bandeira_cartao || null
          });
        } catch (error) {
          console.error('Erro ao registrar venda do onboarding:', error);
        }
      }

      // Registra custos
      for (const custo of custos) {
        try {
          await transactionController.createTransaction(result.user.id, {
            tipo: 'saida',
            valor: custo.valor,
            categoria: custo.categoria || custo.descricao || 'Custo',
            descricao: custo.descricao || '',
            data: custo.data || new Date().toISOString().split('T')[0]
          });
        } catch (error) {
          console.error('Erro ao registrar custo do onboarding:', error);
        }
      }

      response += `*CADASTRO BÁSICO CONCLUÍDO!*\n\n`;
      response += `Ótimo! Já coletei suas informações básicas. Agora falta só uma última etapa para você ter acesso completo.\n\n`;
      response += `*CADASTRE-SE*\n\n`;
      response += `Clique no link abaixo para criar sua conta:\n\n`;
      response += `${result.registrationLink}\n\n`;
      response += `*O que acontece quando você se cadastrar:*\n`;
      response += `• Seu email será vinculado ao seu WhatsApp\n`;
      response += `• Você terá acesso completo a todos os recursos\n`;
      response += `• Todas as transações do WhatsApp ficarão sincronizadas\n\n`;
      response += `*Importante:*\n`;
      response += `• O link é válido por 48 horas\n`;
      response += `• Você pode continuar usando o WhatsApp normalmente enquanto isso\n\n`;
      response += `Assim que finalizar o cadastro, eu te aviso aqui no WhatsApp! 😊`;

      return response;
    } catch (error) {
      console.error('Erro ao mostrar resumo final:', error);
      return 'Erro ao finalizar teste. Tente novamente.';
    }
  }

  async createUserFromOnboarding(data) {
    try {
      const { nome_completo, nome_clinica, telefone } = data;

      // Verifica se já existe um perfil com este telefone
      const { data: existingProfile, error: lookupError } = await supabase
        .from('profiles')
        .select('*')
        .eq('telefone', telefone)
        .single();

      let profile;
      let profileCreated = false;

      if (existingProfile && !lookupError) {
        // PERFIL JÁ EXISTE - apenas atualiza dados
        console.log('Perfil já existe para telefone:', telefone);
        profile = existingProfile;
        
        // Atualiza dados se necessário
        const { data: updatedProfile, error: updateError } = await supabase
          .from('profiles')
          .update({
            nome_completo: nome_completo || existingProfile.nome_completo,
            nome_clinica: nome_clinica || existingProfile.nome_clinica
          })
          .eq('id', existingProfile.id)
          .select()
          .single();

        if (!updateError && updatedProfile) {
          profile = updatedProfile;
        }
      } else {
        // CRIA PERFIL TEMPORÁRIO (sem usuário Auth ainda)
        // O usuário será criado quando se cadastrar no frontend
        console.log('Criando perfil temporário para telefone:', telefone);
        
        // Gera um ID temporário (será atualizado quando vincular email)
        const tempId = require('uuid').v4();
        
        const { data: newProfile, error: profileError } = await supabase
          .from('profiles')
          .insert([{
            id: tempId,
            nome_completo,
            nome_clinica,
            telefone,
            is_active: true,
            email: null // Email será preenchido quando usuário se cadastrar
          }])
          .select()
          .single();

        if (profileError) {
          if (profileError.code === '23505') {
            throw new Error('Este telefone já está cadastrado.');
          }
          throw profileError;
        }

        profile = newProfile;
        profileCreated = true;
        console.log('Perfil temporário criado:', profile.id);
      }

      // Gera token de cadastro e link
      const { token, registrationLink } = await registrationTokenService.generateRegistrationToken(telefone, 48);

      return {
        user: profile,
        registrationLink: registrationLink,
        token: token,
        profileCreated: profileCreated
      };
    } catch (error) {
      console.error('Erro ao criar perfil no onboarding:', error);
      throw error;
    }
  }

  async createDefaultProcedimentos(userId) {
    const defaultProcedimentos = [
      { user_id: userId, nome: 'Botox', tipo: 'botox', custo_material_ml: 50, valor_sugerido: 1500 },
      { user_id: userId, nome: 'Preenchimento Labial', tipo: 'acido', custo_material_ml: 200, valor_sugerido: 2500 },
      { user_id: userId, nome: 'Preenchimento Facial', tipo: 'acido', custo_material_ml: 200, valor_sugerido: 3000 },
      { user_id: userId, nome: 'Harmonização Facial', tipo: 'acido', custo_material_ml: 180, valor_sugerido: 4500 },
      { user_id: userId, nome: 'Bioestimulador', tipo: 'outros', custo_material_ml: 300, valor_sugerido: 3500 }
    ];

    try {
      await supabase.from('procedimentos').insert(defaultProcedimentos);
      console.log('Procedimentos padrão criados para usuário:', userId);
    } catch (error) {
      console.error('Erro ao criar procedimentos padrão:', error);
    }
  }

  async findOrCreateCliente(userId, nomeCliente) {
    try {
      // Tenta encontrar cliente existente pelo nome
      const { data: existingCliente } = await supabase
        .from('clientes')
        .select('*')
        .eq('user_id', userId)
        .ilike('nome', `%${nomeCliente}%`)
        .limit(1)
        .single();

      if (existingCliente) {
        return existingCliente;
      }

      // Cria novo cliente
      const { data: newCliente, error } = await supabase
        .from('clientes')
        .insert([{
          user_id: userId,
          nome: nomeCliente
        }])
        .select()
        .single();

      if (error) throw error;
      return newCliente;
    } catch (error) {
      if (error.code === 'PGRST116') {
        // Cliente não encontrado, criar novo
        const { data: newCliente, error: createError } = await supabase
          .from('clientes')
          .insert([{
            user_id: userId,
            nome: nomeCliente
          }])
          .select()
          .single();

        if (createError) throw createError;
        return newCliente;
      }
      throw error;
    }
  }

  async findOrCreateProcedimento(userId, nomeProcedimento) {
    try {
      // Normaliza o nome do procedimento
      const nomeNormalizado = this.normalizeProcedimentoName(nomeProcedimento);

      // Tenta encontrar procedimento existente
      const { data: existingProc } = await supabase
        .from('procedimentos')
        .select('*')
        .eq('user_id', userId)
        .ilike('nome', `%${nomeNormalizado}%`)
        .limit(1)
        .single();

      if (existingProc) {
        return existingProc;
      }

      // Define tipo baseado no nome
      let tipo = 'outros';
      const nomeLower = nomeNormalizado.toLowerCase();
      if (nomeLower.includes('botox') || nomeLower.includes('toxina')) {
        tipo = 'botox';
      } else if (nomeLower.includes('preench') || nomeLower.includes('acido') || nomeLower.includes('ácido')) {
        tipo = 'acido';
      }

      // Cria novo procedimento
      const { data: newProc, error } = await supabase
        .from('procedimentos')
        .insert([{
          user_id: userId,
          nome: nomeNormalizado,
          tipo: tipo,
          custo_material_ml: tipo === 'botox' ? 50 : tipo === 'acido' ? 200 : 100,
          valor_sugerido: 0
        }])
        .select()
        .single();

      if (error) throw error;
      return newProc;
    } catch (error) {
      if (error.code === 'PGRST116') {
        // Não encontrado, criar
        let tipo = 'outros';
        const nomeLower = nomeProcedimento.toLowerCase();
        if (nomeLower.includes('botox')) tipo = 'botox';
        else if (nomeLower.includes('preench')) tipo = 'acido';

        const { data: newProc, error: createError } = await supabase
          .from('procedimentos')
          .insert([{
            user_id: userId,
            nome: this.normalizeProcedimentoName(nomeProcedimento),
            tipo: tipo,
            custo_material_ml: tipo === 'botox' ? 50 : 200,
            valor_sugerido: 0
          }])
          .select()
          .single();

        if (createError) throw createError;
        return newProc;
      }
      throw error;
    }
  }

  normalizeProcedimentoName(nome) {
    // Capitaliza primeira letra de cada palavra
    return nome.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
}

module.exports = new UserController();
