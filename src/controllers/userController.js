const supabase = require('../db/supabase');
const onboardingService = require('../services/onboardingService');
const emailService = require('../services/emailService');
const registrationTokenService = require('../services/registrationTokenService');
const cacheService = require('../services/cacheService');
const { z } = require('zod');
const { normalizePhone, getPhoneVariants } = require('../utils/phone');
const { formatarMoeda } = require('../utils/currency');

class UserController {
  constructor() {
    // onboardingData movido para onboardingFlowService
  }


  async findUserByPhone(phone) {
    try {
      const normalized = normalizePhone(phone) || phone;
      
      // Try cache first
      const cacheKey = `phone:profile:${normalized}`;
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return cached;
      }

      const variants = getPhoneVariants(phone);

      // 1. Busca na tabela profiles pelo telefone (comportamento original)
      let query = supabase
        .from('profiles')
        .select('*');

      if (variants.length) {
        query = query.in('telefone', variants);
      } else {
        query = query.eq('telefone', normalized);
      }

      const { data: existingUser, error: fetchError } = await query.maybeSingle();

      if (fetchError && fetchError.code !== 'PGRST116') {
        // PGRST116 = não encontrado, outros erros são problemas reais
        throw fetchError;
      }

      // Se encontrou direto em profiles, retorna
      if (existingUser) {
        await cacheService.set(cacheKey, existingUser, 900);
        return existingUser;
      }

      // 2. Se não encontrou em profiles, busca em clinic_members
      let memberQuery = supabase
        .from('clinic_members')
        .select('clinic_id, nome, funcao, is_primary, confirmed')
        .eq('is_active', true);

      if (variants.length) {
        memberQuery = memberQuery.in('telefone', variants);
      } else {
        memberQuery = memberQuery.eq('telefone', normalized);
      }

      const { data: member, error: memberError } = await memberQuery.maybeSingle();

      if (memberError && memberError.code !== 'PGRST116') {
        throw memberError;
      }

      // Se encontrou em clinic_members, busca o profile da clínica
      if (member && member.clinic_id) {
        const { data: clinicProfile, error: clinicError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', member.clinic_id)
          .single();

        if (clinicError) {
          console.error('[USER] Erro ao buscar profile da clínica:', clinicError);
        }

        if (clinicProfile) {
          // Adiciona informação do membro ao profile retornado
          clinicProfile._member = {
            nome: member.nome,
            funcao: member.funcao,
            is_primary: member.is_primary,
            confirmed: member.confirmed,
            phone_used: normalized
          };
          
          await cacheService.set(cacheKey, clinicProfile, 900);
          return clinicProfile;
        }
      }

      return null;
    } catch (error) {
      // Melhor tratamento de erros de conexão
      if (error.message && error.message.includes('fetch failed')) {
        console.error('[USER] Erro de conexão com Supabase ao buscar usuário:', error.message);
        console.error('[USER] Código:', error.code || 'N/A');
        // Relança o erro para que o caller possa tratar
        throw new Error(`Erro de conexão com o banco de dados: ${error.message}`);
      }
      console.error('Erro ao buscar usuário:', error);
      throw error;
    }
  }


  async createUserFromOnboarding(data) {
    try {
      const { nome_completo, nome_clinica } = data;
      const telefone = normalizePhone(data.telefone) || data.telefone;
      const phoneVariants = getPhoneVariants(telefone);

      // Verifica se já existe um perfil com este telefone
      let lookupQuery = supabase.from('profiles').select('*');
      if (phoneVariants.length) {
        lookupQuery = lookupQuery.in('telefone', phoneVariants);
      } else {
        lookupQuery = lookupQuery.eq('telefone', telefone);
      }
      const { data: existingProfile, error: lookupError } = await lookupQuery.maybeSingle();

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
            telefone: telefone,
            is_active: true,
            email: data.email || null,
            whatsapp_contato: data.whatsapp || data.whatsapp_contato || telefone,
            cidade: data.cidade,
            tipo_clinica: data.tipo_clinica,
            ticket_medio: data.ticket_medio,
            procedimentos_mes: data.procedimentos_mes
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
      // UPSERT: 1 query ao invés de 2 (SELECT + INSERT)
      // Usa constraint UNIQUE (user_id, nome) para detectar duplicatas
      const { data, error } = await supabase
        .from('clientes')
        .upsert({
          user_id: userId,
          nome: nomeCliente.trim()
        }, {
          onConflict: 'user_id,nome',
          ignoreDuplicates: false
        })
        .select()
        .single();

      if (error) {
        // Se UPSERT falhar (ex: constraint não existe ainda), faz fallback para SELECT+INSERT
        if (error.code === '23505' || error.message?.includes('unique')) {
          // Constraint existe mas deu conflito - busca o existente
          const { data: existing } = await supabase
            .from('clientes')
            .select('*')
            .eq('user_id', userId)
            .eq('nome', nomeCliente.trim())
            .single();
          
          if (existing) return existing;
        }
        
        // Se não encontrou, tenta criar (fallback para método antigo)
        const { data: newCliente, error: insertError } = await supabase
          .from('clientes')
          .insert([{
            user_id: userId,
            nome: nomeCliente.trim()
          }])
          .select()
          .single();

        if (insertError) throw insertError;
        return newCliente;
      }

      return data;
    } catch (error) {
      // Fallback completo: método antigo (SELECT + INSERT)
      try {
        const { data: existingCliente } = await supabase
          .from('clientes')
          .select('*')
          .eq('user_id', userId)
          .ilike('nome', `%${nomeCliente.trim()}%`)
          .limit(1)
          .single();

        if (existingCliente) {
          return existingCliente;
        }

        const { data: newCliente, error: insertError } = await supabase
          .from('clientes')
          .insert([{
            user_id: userId,
            nome: nomeCliente.trim()
          }])
          .select()
          .single();

        if (insertError) throw insertError;
        return newCliente;
      } catch (fallbackError) {
        console.error('[USER] Erro ao criar/buscar cliente:', fallbackError);
        throw fallbackError;
      }
    }
  }

  async findOrCreateProcedimento(userId, nomeProcedimento) {
    try {
      // Normaliza o nome do procedimento
      const nomeNormalizado = this.normalizeProcedimentoName(nomeProcedimento);

      // Define tipo baseado no nome
      let tipo = 'outros';
      const nomeLower = nomeNormalizado.toLowerCase();
      if (nomeLower.includes('botox') || nomeLower.includes('toxina')) {
        tipo = 'botox';
      } else if (nomeLower.includes('preench') || nomeLower.includes('acido') || nomeLower.includes('ácido')) {
        tipo = 'acido';
      }

      const custoMaterial = tipo === 'botox' ? 50 : tipo === 'acido' ? 200 : 100;

      // UPSERT: 1 query ao invés de 2 (SELECT + INSERT)
      // Usa constraint UNIQUE (user_id, nome) para detectar duplicatas
      const { data, error } = await supabase
        .from('procedimentos')
        .upsert({
          user_id: userId,
          nome: nomeNormalizado,
          tipo: tipo,
          custo_material_ml: custoMaterial,
          valor_sugerido: 0
        }, {
          onConflict: 'user_id,nome',
          ignoreDuplicates: false
        })
        .select()
        .single();

      if (error) {
        // Se UPSERT falhar (ex: constraint não existe ainda), faz fallback para SELECT+INSERT
        if (error.code === '23505' || error.message?.includes('unique')) {
          // Constraint existe mas deu conflito - busca o existente
          const { data: existing } = await supabase
            .from('procedimentos')
            .select('*')
            .eq('user_id', userId)
            .eq('nome', nomeNormalizado)
            .single();
          
          if (existing) return existing;
        }
        
        // Se não encontrou, tenta criar (fallback para método antigo)
        const { data: newProc, error: insertError } = await supabase
          .from('procedimentos')
          .insert([{
            user_id: userId,
            nome: nomeNormalizado,
            tipo: tipo,
            custo_material_ml: custoMaterial,
            valor_sugerido: 0
          }])
          .select()
          .single();

        if (insertError) throw insertError;
        return newProc;
      }

      return data;
    } catch (error) {
      // Fallback completo: método antigo (SELECT + INSERT)
      try {
        const nomeNormalizado = this.normalizeProcedimentoName(nomeProcedimento);
        
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

        let tipo = 'outros';
        const nomeLower = nomeNormalizado.toLowerCase();
        if (nomeLower.includes('botox') || nomeLower.includes('toxina')) {
          tipo = 'botox';
        } else if (nomeLower.includes('preench') || nomeLower.includes('acido') || nomeLower.includes('ácido')) {
          tipo = 'acido';
        }

        const { data: newProc, error: insertError } = await supabase
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

        if (insertError) throw insertError;
        return newProc;
      } catch (fallbackError) {
        console.error('[USER] Erro ao criar/buscar procedimento:', fallbackError);
        throw fallbackError;
      }
    }
  }

  normalizeProcedimentoName(nome) {
    // Capitaliza primeira letra de cada palavra
    return nome.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  async buildResumoFinal(phone, onboarding, registrationLink = null) {
    // Calcula totais
    let receitaTotal = 0;
    let custosVariaveis = 0;
    let custosFixos = 0;

    if (onboarding.data.primeira_venda?.valor) {
      receitaTotal = parseFloat(onboarding.data.primeira_venda.valor);
    }

    if (onboarding.data.primeiro_custo?.valor) {
      if (onboarding.data.primeiro_custo.tipo_custo === 'variável') {
        custosVariaveis = parseFloat(onboarding.data.primeiro_custo.valor);
      } else {
        custosFixos = parseFloat(onboarding.data.primeiro_custo.valor);
      }
    }

    if (onboarding.data.segundo_custo?.valor) {
      custosFixos = parseFloat(onboarding.data.segundo_custo.valor);
    }

    const saldoInicial = receitaTotal - custosVariaveis - custosFixos;

    let resumo = `Perfeito! Já organizei suas três primeiras informações 🎉\n\n`;
    resumo += `Aqui vai um resumo inicial, só para você ver como tudo começa a tomar forma:\n\n`;
    resumo += `📊 *Primeiros dados da sua clínica*\n\n`;
    resumo += `• Receita cadastrada: ${formatarMoeda(receitaTotal)}\n`;
    resumo += `• Custos do mês (parciais):\n`;
    resumo += `  • Custos variáveis registrados: ${formatarMoeda(custosVariaveis)}\n`;
    resumo += `  • Custos fixos registrados: ${formatarMoeda(custosFixos)}\n`;
    resumo += `• Saldo inicial: ${formatarMoeda(saldoInicial)}\n\n`;
    resumo += `(esse saldo muda rápido conforme você registra suas vendas e custos reais)\n\n`;
    resumo += `Com mais dados, te mostro gráficos, histórico, totais, projeções e muito mais — tudo automaticamente 💜\n\n`;

    if (registrationLink) {
      // Link do dashboard desativado temporariamente conforme solicitado
      // resumo += `*CADASTRE-SE PARA ACESSO COMPLETO*\n\n`;
      // resumo += `Clique no link abaixo para criar sua conta:\n\n`;
      // resumo += `${registrationLink}\n\n`;

      resumo += `*Tudo pronto!* 🚀\n\n`;
      resumo += `Seu cadastro foi realizado com sucesso.\n\n`;
      resumo += `Agora é só usar! Pode me mandar suas vendas e custos por aqui mesmo.\n\n`;
      resumo += `Exemplos:\n`;
      resumo += `_"Vendi um botox por R$ 1500"_\n`;
      resumo += `_"Gastei R$ 200 com luvas"_\n\n`;
      resumo += `Qualquer dúvida, é só mandar "ajuda"! 😊`;
    }

    return resumo;
  }

  async saveOnboardingTransactions(userId, data) {
    try {
      // Salva primeira venda (entrada)
      if (data.primeira_venda) {
        const venda = data.primeira_venda;

        // Busca ou cria cliente
        let clienteId = null;
        if (venda.nome_cliente) {
          const cliente = await this.findOrCreateCliente(userId, venda.nome_cliente);
          clienteId = cliente.id;
        }

        // Busca ou cria procedimento
        let procedimentoId = null;
        if (venda.categoria) {
          const procedimento = await this.findOrCreateProcedimento(userId, venda.categoria);
          procedimentoId = procedimento.id;
        }

        // Cria atendimento
        const { data: atendimento, error: atendError } = await supabase
          .from('atendimentos')
          .insert([{
            user_id: userId,
            cliente_id: clienteId,
            valor_total: venda.valor,
            data: venda.data || new Date().toISOString().split('T')[0],
            observacoes: venda.descricao || '',
            forma_pagamento: venda.forma_pagamento || 'avista'
          }])
          .select()
          .single();

        if (!atendError && atendimento && procedimentoId) {
          // Cria relação atendimento-procedimento
          await supabase
            .from('atendimento_procedimentos')
            .insert([{
              atendimento_id: atendimento.id,
              procedimento_id: procedimentoId,
              quantidade: 1
            }]);
        }

        // Se for parcelado, cria parcelas
        if (venda.forma_pagamento === 'parcelado' && venda.parcelas) {
          const valorParcela = venda.valor / venda.parcelas;
          const parcelas = [];
          const dataBase = new Date(venda.data || new Date());

          for (let i = 0; i < venda.parcelas; i++) {
            const dataParcela = new Date(dataBase);
            dataParcela.setMonth(dataParcela.getMonth() + i);

            parcelas.push({
              atendimento_id: atendimento.id,
              numero: i + 1,
              valor: valorParcela,
              data_vencimento: dataParcela.toISOString().split('T')[0],
              paga: false,
              bandeira_cartao: venda.bandeira_cartao || null
            });
          }

          await supabase.from('parcelas').insert(parcelas);
        }
      }

      // Salva primeiro custo
      if (data.primeiro_custo) {
        const custo = data.primeiro_custo;
        await supabase
          .from('contas_pagar')
          .insert([{
            user_id: userId,
            valor: custo.valor,
            data: custo.data || new Date().toISOString().split('T')[0],
            descricao: custo.descricao || custo.categoria || 'Custo',
            categoria: custo.categoria || 'Outros',
            forma_pagamento: custo.forma_pagamento || 'avista',
            tipo_custo: custo.tipo_custo || 'variável'
          }]);
      }

      // Salva segundo custo (fixo)
      if (data.segundo_custo) {
        const custo = data.segundo_custo;
        await supabase
          .from('contas_pagar')
          .insert([{
            user_id: userId,
            valor: custo.valor,
            data: custo.data || new Date().toISOString().split('T')[0],
            descricao: custo.descricao || custo.categoria || 'Custo fixo',
            categoria: custo.categoria || 'Custo fixo',
            forma_pagamento: custo.forma_pagamento || 'avista',
            tipo_custo: 'fixo',
            recorrente: true // Marca como recorrente
          }]);
      }

      console.log('[ONBOARDING] Transações salvas com sucesso para usuário:', userId);
    } catch (error) {
      console.error('[ONBOARDING] Erro ao salvar transações:', error);
      // Não lança erro para não quebrar o fluxo
    }
  }
  async migrateUserData(oldUserId, newUserId) {
    console.log(`[MIGRATION] Iniciando migração de dados de ${oldUserId} para ${newUserId}`);

    try {
      // 1. Migrar Procedimentos
      const { error: procError } = await supabase
        .from('procedimentos')
        .update({ user_id: newUserId })
        .eq('user_id', oldUserId);

      if (procError) console.error('[MIGRATION] Erro ao migrar procedimentos:', procError);
      else console.log('[MIGRATION] Procedimentos migrados');

      // 2. Migrar Clientes
      const { error: cliError } = await supabase
        .from('clientes')
        .update({ user_id: newUserId })
        .eq('user_id', oldUserId);

      if (cliError) console.error('[MIGRATION] Erro ao migrar clientes:', cliError);
      else console.log('[MIGRATION] Clientes migrados');

      // 3. Migrar Atendimentos
      const { error: atendError } = await supabase
        .from('atendimentos')
        .update({ user_id: newUserId })
        .eq('user_id', oldUserId);

      if (atendError) console.error('[MIGRATION] Erro ao migrar atendimentos:', atendError);
      else console.log('[MIGRATION] Atendimentos migrados');

      // 4. Migrar Contas a Pagar
      const { error: contasError } = await supabase
        .from('contas_pagar')
        .update({ user_id: newUserId })
        .eq('user_id', oldUserId);

      if (contasError) console.error('[MIGRATION] Erro ao migrar contas a pagar:', contasError);
      else console.log('[MIGRATION] Contas a pagar migradas');

      // 5. Migrar Parcelas (se tiver user_id, se não tiver, elas migram junto com atendimento)
      // Verificando schema: parcelas geralmente ligadas a atendimento, mas se tiver user_id direto, migrar.
      // Assumindo que pode ter user_id para facilitar queries
      try {
        await supabase
          .from('parcelas')
          .update({ user_id: newUserId })
          .eq('user_id', oldUserId);
      } catch (e) {
        // Ignora se não tiver coluna user_id
      }

      console.log('[MIGRATION] Migração concluída com sucesso');
      return true;
    } catch (error) {
      console.error('[MIGRATION] Erro crítico na migração:', error);
      return false;
    }
  }

  async linkEmail(req, res) {
    try {
      // Schema de validação
      const linkEmailSchema = z.object({
        phone: z.string().min(10, 'Telefone inválido'),
        token: z.string().min(10, 'Token inválido'),
        email: z.string().email('Email inválido'),
        password: z.string().min(6, 'A senha deve ter no mínimo 6 caracteres')
      });

      // Validação
      const validationResult = linkEmailSchema.safeParse(req.body);

      if (!validationResult.success) {
        console.error('[LINK_EMAIL] Validation Error:', JSON.stringify(validationResult.error, null, 2));
        const errors = validationResult.error.errors || validationResult.error.issues || [];
        return res.status(400).json({
          error: 'Dados inválidos',
          details: errors.map(e => e.message)
        });
      }

      const { phone, token, email, password } = validationResult.data;

      // Valida o token de cadastro
      const tokenValidation = await registrationTokenService.validateRegistrationToken(token);

      if (!tokenValidation.valid || tokenValidation.phone !== phone) {
        return res.status(400).json({
          error: 'Token inválido ou expirado'
        });
      }

      // Busca o perfil existente pelo telefone
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('telefone', phone)
        .single();

      if (profileError || !profile) {
        return res.status(404).json({
          error: 'Perfil não encontrado para este telefone'
        });
      }

      // Verifica se já existe usuário com este email
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find(u => u.email === email);

      if (existingUser) {
        return res.status(400).json({
          error: 'Este email já está cadastrado'
        });
      }

      // Cria usuário no Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: {
          nome_completo: profile.nome_completo,
          nome_clinica: profile.nome_clinica,
          telefone: phone
        }
      });

      if (authError) {
        console.error('[LINK_EMAIL] Erro ao criar usuário Auth:', authError);
        return res.status(500).json({
          error: 'Erro ao criar conta. Tente novamente.'
        });
      }

      const userId = authData.user.id;

      // Cria novo perfil com o ID do Auth (não podemos atualizar ID de chave primária)
      // Tenta inserir. Se falhar por unique constraint (telefone), deleta o antigo e tenta de novo.
      let createError;

      try {
        const { error } = await supabase
          .from('profiles')
          .insert([{
            id: userId,
            nome_completo: profile.nome_completo,
            nome_clinica: profile.nome_clinica,
            telefone: profile.telefone,
            email: email,
            whatsapp_contato: profile.whatsapp_contato || profile.telefone,
            cidade: profile.cidade,
            tipo_clinica: profile.tipo_clinica,
            ticket_medio: profile.ticket_medio,
            procedimentos_mes: profile.procedimentos_mes,
            is_active: true
          }]);
        createError = error;
      } catch (err) {
        createError = err;
      }

      if (createError) {
        // Se der erro de unique constraint (provavelmente telefone duplicado)
        if (createError.code === '23505') {
          console.log('[LINK_EMAIL] Conflito de telefone/ID detectado. Tentando resolver...');

          // Se o conflito for no ID (usuário já existe com esse ID), tenta atualizar
          // Mas se for no telefone (perfil antigo existe), precisamos deletar o antigo

          // IMPORTANTE: Migrar dados antes de deletar!
          if (profile.id !== userId) {
            console.log('[LINK_EMAIL] Migrando dados do perfil antigo para o novo Auth User...');
            await this.migrateUserData(profile.id, userId);

            // Agora pode deletar o perfil antigo com segurança
            const { error: deleteError } = await supabase
              .from('profiles')
              .delete()
              .eq('id', profile.id);

            if (deleteError) {
              console.error('[LINK_EMAIL] Erro ao deletar perfil antigo:', deleteError);
              // Se não conseguiu deletar, falha
              await supabase.auth.admin.deleteUser(userId);
              return res.status(500).json({ error: 'Erro ao resolver conflito de perfil' });
            }

            // Tenta inserir novamente
            const { error: retryError } = await supabase
              .from('profiles')
              .insert([{
                id: userId,
                nome_completo: profile.nome_completo,
                nome_clinica: profile.nome_clinica,
                telefone: profile.telefone,
                email: email,
                whatsapp_contato: profile.whatsapp_contato || profile.telefone,
                cidade: profile.cidade,
                tipo_clinica: profile.tipo_clinica,
                ticket_medio: profile.ticket_medio,
                procedimentos_mes: profile.procedimentos_mes,
                is_active: true
              }]);

            if (retryError) {
              await supabase.auth.admin.deleteUser(userId);
              console.error('[LINK_EMAIL] Erro ao criar perfil (tentativa 2):', retryError);
              return res.status(500).json({ error: 'Erro ao criar perfil' });
            }
          } else {
            // Se IDs são iguais (improvável aqui), tenta atualizar
            const { error: updateError } = await supabase
              .from('profiles')
              .update({ email: email })
              .eq('id', userId);

            if (updateError) {
              await supabase.auth.admin.deleteUser(userId);
              console.error('[LINK_EMAIL] Erro ao atualizar perfil:', updateError);
              return res.status(500).json({ error: 'Erro ao vincular email ao perfil' });
            }
          }
        } else {
          // Outro erro
          await supabase.auth.admin.deleteUser(userId);
          console.error('[LINK_EMAIL] Erro ao criar perfil:', createError);
          return res.status(500).json({
            error: 'Erro ao vincular email ao perfil: ' + createError.message
          });
        }
      } else {
        // Sucesso na primeira tentativa
        // Se criou novo perfil e não deu erro, deleta o perfil temporário antigo se IDs forem diferentes
        // (Mas se inseriu com sucesso, significa que não houve conflito de telefone, então o antigo já não existia ou telefone não é unique?)
        // Se telefone é unique, o insert falharia. Se não é unique, temos duplicata.
        // Vamos garantir que não temos duplicata deletando o antigo se ID for diferente.

        if (profile.id !== userId) {
          // Migra dados antes de deletar qualquer coisa, por segurança
          console.log('[LINK_EMAIL] Migrando dados (caso sem conflito)...');
          await this.migrateUserData(profile.id, userId);

          // Verifica se o antigo ainda existe (pode não ser unique o telefone)
          await supabase
            .from('profiles')
            .delete()
            .eq('id', profile.id);
        }
      }

      // Cria role de admin
      await supabase
        .from('user_roles')
        .insert([{
          user_id: userId,
          role: 'admin'
        }]);

      // Marca token como usado
      await registrationTokenService.markTokenAsUsed(tokenValidation.tokenId);

      // Envia mensagem de confirmação via WhatsApp
      try {
        const evolutionService = require('../services/evolutionService');
        const confirmationMessage = `*CADASTRO CONCLUÍDO COM SUCESSO!*\n\n` +
          `Seu email foi vinculado ao seu WhatsApp!\n\n` +
          `Agora você tem acesso completo:\n` +
          `🌐 lumiz-financeiro.vercel.app\n\n` +
          `*Pronto pra começar?* 🚀\n\n` +
          `Me manda sua primeira venda assim:\n` +
          `_"Botox 2800 paciente Maria"_\n\n` +
          `Ou manda "ajuda" que te mostro tudo que sei fazer! 😊`;

        await evolutionService.sendMessage(phone, confirmationMessage);
      } catch (whatsappError) {
        console.error('[LINK_EMAIL] Erro ao enviar mensagem WhatsApp (não crítico):', whatsappError);
      }

      // Envia email de boas-vindas
      try {
        await emailService.sendWelcomeEmail(email, profile.nome_completo);
      } catch (emailError) {
        console.error('[LINK_EMAIL] Erro ao enviar email de boas-vindas (não crítico):', emailError);
      }

      return res.json({
        success: true,
        message: 'Email vinculado com sucesso',
        userId: userId
      });

    } catch (error) {
      console.error('[LINK_EMAIL] Erro:', error);
      return res.status(500).json({ error: error.message || 'Erro interno' });
    }
  }
}

module.exports = new UserController();
