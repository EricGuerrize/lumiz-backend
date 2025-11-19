const supabase = require('../db/supabase');
const onboardingService = require('../services/onboardingService');
const emailService = require('../services/emailService');

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
        return 'Perfeito! Assim que finalizarmos, você pode cadastrar as taxas pelo dashboard ou me enviar um print da maquininha que eu leio via OCR.';
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
      `📧 *Email:* ${onboarding.data.email}`,
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

  async startOnboarding(phone) {
    this.onboardingData.set(phone, {
      step: 'nome_completo',
      data: {
        telefone: phone,
        cnpj_status: 'pending'
      },
      timestamp: Date.now()
    });

    try {
      await onboardingService.ensureState(phone, null, {
        stage: 'phase1',
        channel: 'whatsapp',
        abVariant: 'whatsapp_v1'
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
      case 'nome_completo': {
        if (messageTrimmed.length < 3) {
          return 'Por favor, digite seu nome completo (mínimo 3 caracteres).';
        }
        onboarding.data.nome_completo = messageTrimmed;
        onboarding.step = 'nome_clinica';

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

        const progressLabel = await onboardingService.getProgressLabel(phone);
        const progressText = progressLabel ? `\n\n${progressLabel}` : '';

        return `Prazer, ${messageTrimmed.split(' ')[0]}! 😊${progressText}\n\nAgora me diz: *Qual o nome da sua clínica?*`;
      }

      case 'nome_clinica': {
        if (messageTrimmed.length < 2) {
          return 'Por favor, digite o nome da clínica.';
        }
        onboarding.data.nome_clinica = messageTrimmed;
        onboarding.step = 'email';

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

        const progressLabel = await onboardingService.getProgressLabel(phone);
        const progressText = progressLabel ? `\n\n${progressLabel}` : '';

        return `*${messageTrimmed}* - nome bonito! 💜${progressText}\n\nAgora me diz: *Qual seu email?*\n(Você usa para acessar o dashboard)`;
      }

      case 'email': {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(messageTrimmed)) {
          return 'Esse email não parece válido. 🤔\n\nDigite um email válido (ex: seu@email.com)';
        }
        onboarding.data.email = messageTrimmed.toLowerCase();
        onboarding.step = 'cnpj';

        try {
          await onboardingService.savePhaseData(phone, 'phase1', {
            email: onboarding.data.email
          });
          await onboardingService.updateStepStatus(phone, 'phase1_email', 'completed', {
            value: onboarding.data.email
          });
        } catch (error) {
          console.error('Erro ao salvar progresso (email):', error);
        }

        const progressLabel = await onboardingService.getProgressLabel(phone);
        const progressText = progressLabel ? `\n\n${progressLabel}` : '';

        return `Perfeito!${progressText}\n\nAgora, se tiver o *CNPJ da clínica*, já me passa? Assim deixo tudo pronto.\n\nSe preferir, responda *Pular* ou *Prefiro não informar agora*.`;
      }

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

            if (result.userAlreadyExisted) {
              // Usuário já tinha conta - apenas vinculou WhatsApp
              response = `✅ *WHATSAPP VINCULADO COM SUCESSO!*\n\n` +
                     `Identifiquei que você já tem uma conta com o email *${onboarding.data.email}*!\n\n` +
                     `Vinculei este WhatsApp à sua conta existente. Agora todas as transações que você registrar aqui vão aparecer no dashboard! 🎉\n\n`;

              response += `📱 *Seu telefone foi vinculado:* ${phone}\n\n`;
            } else {
              // Usuário novo
              if (result.userAlreadyExisted) {
                // Usuário já existia, apenas vinculou telefone
                response = `*CONTA VINCULADA COM SUCESSO!*\n\n` +
                          `Seu WhatsApp foi vinculado à sua conta existente!\n\n` +
                          `📧 Email: ${onboarding.data.email}\n` +
                          `🌐 Dashboard: lumiz-financeiro.vercel.app\n\n`;
              } else {
                // Usuário novo criado
                response = `*CONTA CRIADA COM SUCESSO!*\n\n` +
                          `Seu cadastro está pronto! Agora você pode usar a Lumiz pelo WhatsApp e pelo dashboard online.\n\n` +
                          `*CONFIGURAÇÃO DE SENHA*\n\n` +
                          `Enviamos um email para:\n📧 ${onboarding.data.email}\n\n` +
                          `No email você encontrará um link para criar sua senha de acesso ao dashboard.\n\n` +
                          `*Importante:*\n` +
                          `• O link é válido por 24 horas\n` +
                          `• Verifique sua caixa de entrada e spam\n` +
                          `• Após criar a senha, você poderá acessar o dashboard\n\n` +
                          `🌐 Dashboard: lumiz-financeiro.vercel.app\n\n`;
              }
            }

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

  async createUserFromOnboarding(data) {
    try {
      const { nome_completo, nome_clinica, telefone, email } = data;

      // PRIMEIRO: Verifica se já existe um usuário com este email
      const { data: existingAuthUser, error: lookupError } = await supabase.auth.admin.listUsers();

      let existingUser = null;
      if (!lookupError && existingAuthUser?.users) {
        existingUser = existingAuthUser.users.find(u => u.email === email);
      }

      let userId;
      let tempPassword = null;
      let userCreated = false;

      if (existingUser) {
        // USUÁRIO JÁ EXISTE! Apenas atualiza o profile com telefone
        userId = existingUser.id;
        console.log('Usuário já existe (email):', email, '- ID:', userId);
        console.log('Atualizando telefone e dados do profile...');

        // Atualiza o profile existente com telefone e outros dados do WhatsApp
        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            telefone: telefone,
            nome_completo: nome_completo || existingUser.user_metadata?.nome_completo,
            nome_clinica: nome_clinica || existingUser.user_metadata?.nome_clinica
          })
          .eq('id', userId);

        if (updateError) {
          console.error('Erro ao atualizar profile:', updateError);
          throw new Error('Erro ao vincular telefone à conta existente.');
        }

        console.log('Profile atualizado com sucesso! Telefone vinculado:', telefone);

        // Não cria senha nova, usuário já tem credenciais
        userCreated = false;
      } else {
        // USUÁRIO NÃO EXISTE - Cria novo
        console.log('Criando novo usuário:', email);

        // Gera uma senha temporária aleatória
        tempPassword = Math.random().toString(36).slice(-12) + 'A1!';

        // Cria usuário no Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email: email,
          password: tempPassword,
          email_confirm: true, // Confirma email automaticamente
          user_metadata: {
            nome_completo,
            nome_clinica,
            telefone
          }
        });

        if (authError) {
          console.error('Erro Auth:', authError);
          throw new Error('Erro ao criar conta. Tente novamente.');
        }

        userId = authData.user.id;
        userCreated = true;
        console.log('Usuário Auth criado:', userId);

        // Cria profile com o mesmo ID do Auth
        const { data: newUser, error: profileError } = await supabase
          .from('profiles')
          .insert([{
            id: userId,
            nome_completo,
            nome_clinica,
            telefone,
            is_active: true
          }])
          .select()
          .single();

        if (profileError) {
          // Se der erro no profile, deleta o usuário do Auth
          await supabase.auth.admin.deleteUser(userId);
          if (profileError.code === '23505') {
            throw new Error('Este telefone já está cadastrado.');
          }
          throw profileError;
        }

        // Cria role de admin para o usuário (se novo)
        await supabase
          .from('user_roles')
          .insert([{
            user_id: userId,
            role: 'admin'
          }]);
      }

      // Busca o profile atualizado/criado
      const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (fetchError) {
        throw new Error('Erro ao buscar profile atualizado.');
      }

      // Envia email de setup (apenas se usuário novo)
      if (userCreated) {
        try {
          await emailService.sendSetupEmail(email, nome_completo);
          console.log('[USER] Email de setup enviado para:', email);
        } catch (emailError) {
          console.error('[USER] Erro ao enviar email de setup (não crítico):', emailError);
          // Não bloqueia a criação do usuário se o email falhar
        }
      }

      return {
        user: profile,
        tempPassword: null, // Não retorna mais senha temporária
        userAlreadyExisted: !userCreated // Flag para mensagem customizada
      };
    } catch (error) {
      console.error('Erro ao criar usuário no onboarding:', error);
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
