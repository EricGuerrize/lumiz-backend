const supabase = require('../db/supabase');

class UserController {
  constructor() {
    // Armazena dados de onboarding em andamento
    this.onboardingData = new Map();
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

  startOnboarding(phone) {
    this.onboardingData.set(phone, {
      step: 'nome_completo',
      data: { telefone: phone },
      timestamp: Date.now()
    });
  }

  async processOnboarding(phone, message) {
    const onboarding = this.onboardingData.get(phone);
    if (!onboarding) return null;

    const messageTrimmed = message.trim();

    switch (onboarding.step) {
      case 'nome_completo':
        if (messageTrimmed.length < 3) {
          return 'Por favor, digite seu nome completo (mínimo 3 caracteres).';
        }
        onboarding.data.nome_completo = messageTrimmed;
        onboarding.step = 'nome_clinica';
        return `Prazer, ${messageTrimmed.split(' ')[0]}! 😊\n\nAgora me diz: *Qual o nome da sua clínica?*`;

      case 'nome_clinica':
        if (messageTrimmed.length < 2) {
          return 'Por favor, digite o nome da clínica.';
        }
        onboarding.data.nome_clinica = messageTrimmed;
        onboarding.step = 'email';
        return `*${messageTrimmed}* - nome bonito! 💜\n\nÚltima pergunta: *Qual seu email?*\n\n(Você vai usar esse email para acessar o dashboard online)`;

      case 'email':
        // Validação básica de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(messageTrimmed)) {
          return 'Esse email não parece válido. 🤔\n\nDigite um email válido (ex: seu@email.com)';
        }
        onboarding.data.email = messageTrimmed.toLowerCase();

        // Finaliza o cadastro
        try {
          const result = await this.createUserFromOnboarding(onboarding.data);
          this.onboardingData.delete(phone);

          // Cria procedimentos padrão
          await this.createDefaultProcedimentos(result.user.id);

          let response = `🎉 *CADASTRO CONCLUÍDO!*\n\n` +
                 `✅ Nome: ${result.user.nome_completo}\n` +
                 `✅ Clínica: ${result.user.nome_clinica}\n` +
                 `✅ Email: ${onboarding.data.email}\n` +
                 `✅ WhatsApp: ${phone}\n\n`;

          response += `🔐 *ACESSO AO DASHBOARD:*\n` +
                     `Email: ${onboarding.data.email}\n` +
                     `Senha: ${result.tempPassword}\n\n` +
                     `Acesse: https://lumiz-financeiro.vercel.app\n\n`;

          if (result.resetLink) {
            response += `_Recomendamos trocar a senha depois._\n\n`;
          }

          response += `Agora você pode:\n` +
                 `📝 Registrar atendimentos\n` +
                 `📊 Ver relatórios\n` +
                 `💰 Controlar finanças\n\n` +
                 `*Comece assim:*\n` +
                 `"Botox 2800 paciente Maria"\n` +
                 `"Preenchimento 1500 João"\n\n` +
                 `Ou digite "ajuda" para ver mais opções! 😊`;

          return response;
        } catch (error) {
          console.error('Erro ao criar usuário:', error);
          this.onboardingData.delete(phone);
          return `Erro ao criar cadastro 😢\n\n${error.message}\n\nTente novamente enviando qualquer mensagem.`;
        }

      default:
        this.onboardingData.delete(phone);
        return 'Algo deu errado no cadastro. Envie qualquer mensagem para recomeçar.';
    }
  }

  async createUserFromOnboarding(data) {
    try {
      const { nome_completo, nome_clinica, telefone, email } = data;

      // Gera uma senha temporária aleatória
      const tempPassword = Math.random().toString(36).slice(-12) + 'A1!';

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
        if (authError.message.includes('already been registered')) {
          throw new Error('Este email já está cadastrado. Use outro email.');
        }
        console.error('Erro Auth:', authError);
        throw new Error('Erro ao criar conta. Tente novamente.');
      }

      const userId = authData.user.id;
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

      // Cria role de admin para o usuário
      await supabase
        .from('user_roles')
        .insert([{
          user_id: userId,
          role: 'admin'
        }]);

      // Gera link de reset de senha para o usuário definir sua senha
      let resetLink = null;
      try {
        const { data: resetData, error: resetError } = await supabase.auth.admin.generateLink({
          type: 'recovery',
          email: email,
          options: {
            redirectTo: process.env.DASHBOARD_URL || 'https://lumiz-financeiro.vercel.app'
          }
        });

        if (!resetError && resetData) {
          resetLink = resetData.properties?.action_link;
        }
      } catch (linkError) {
        console.error('Erro ao gerar link de reset:', linkError);
      }

      return {
        user: newUser,
        resetLink,
        tempPassword // Envia senha temporária para login imediato
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
