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

  async startNewOnboarding(phone) {
    this.onboardingData.set(phone, {
      step: 'nome_clinica',
      data: {
        telefone: phone,
        primeira_venda: null,
        primeiro_custo: null,
        segundo_custo: null
      },
      timestamp: Date.now()
    });

    try {
      await onboardingService.ensureState(phone, null, {
        stage: 'phase1',
        channel: 'whatsapp',
        abVariant: 'whatsapp_v2'
      });
      await onboardingService.updateStepStatus(phone, 'phase1_welcome', 'completed', {
        channel: 'whatsapp'
      });
    } catch (error) {
      console.error('Erro ao iniciar novo onboarding:', error);
    }
  }

  async processOnboarding(phone, message) {
    const onboarding = this.onboardingData.get(phone);
    if (!onboarding) return null;

    const messageTrimmed = message.trim();

    switch (onboarding.step) {
      // ========== NOVO FLUXO DE ONBOARDING (TESTE GRATUITO) ==========
      case 'nome_clinica': {
        // Verifica se é novo fluxo (tem primeira_venda no data)
        if (onboarding.data.primeira_venda === undefined) {
          // Novo fluxo
          if (messageTrimmed.length < 2) {
            return 'Por favor, digite o nome da sua clínica.';
          }
          onboarding.data.nome_clinica = messageTrimmed;
          onboarding.step = 'nome_completo';
          return `Perfeito! 😄\n\nE qual o seu nome mesmo? Vou te chamar direitinho aqui 😉`;
        }
        // Fallthrough para fluxo antigo
      }

      case 'nome_completo': {
        // Verifica se é novo fluxo
        if (onboarding.data.primeira_venda === undefined && onboarding.step === 'nome_completo') {
          // Novo fluxo
          if (messageTrimmed.length < 3) {
            return 'Por favor, digite seu nome (mínimo 3 caracteres).';
          }
          onboarding.data.nome_completo = messageTrimmed;
          onboarding.step = 'funcao';
          return `Prazer, ${messageTrimmed.split(' ')[0]}! 😊\n\nVocê é:\n1. Proprietária(o) da clínica\n2. Gestora(o)\n3. Recepcionista\n4. Outra função`;
        }
        // Fallthrough para fluxo antigo
      }

      case 'funcao': {
        const funcaoNum = parseInt(messageTrimmed);
        if (funcaoNum >= 1 && funcaoNum <= 4) {
          const funcoes = {
            1: 'Proprietária(o)',
            2: 'Gestora(o)',
            3: 'Recepcionista',
            4: 'Outra função'
          };
          onboarding.data.funcao = funcoes[funcaoNum];
          onboarding.step = 'formas_pagamento';
          return `Ótimo! Agora me conta:\n\nHoje você recebe como? (Pode marcar mais de uma)\n\n1. PIX\n2. Cartão\n3. Dinheiro\n4. Link de pagamento\n5. Outros\n\nDigite os números separados por vírgula (ex: 1,2,3)`;
        }
        return 'Por favor, digite um número de 1 a 4.';
      }

      case 'formas_pagamento': {
        const numeros = messageTrimmed.split(/[,\s]+/).map(n => parseInt(n.trim())).filter(n => !isNaN(n) && n >= 1 && n <= 5);
        if (numeros.length === 0) {
          return 'Por favor, digite os números das formas de pagamento separados por vírgula (ex: 1,2,3).';
        }
        const formas = {
          1: 'PIX',
          2: 'Cartão',
          3: 'Dinheiro',
          4: 'Link de pagamento',
          5: 'Outros'
        };
        onboarding.data.formas_pagamento = numeros.map(n => formas[n]);
        onboarding.step = 'vendas_mes';
        return `Perfeito! Agora me diz:\n\nEm média, quantas vendas você faz por mês?`;
      }

      case 'vendas_mes': {
        const vendas = parseInt(messageTrimmed);
        if (isNaN(vendas) || vendas < 0) {
          return 'Por favor, digite um número válido de vendas por mês.';
        }
        onboarding.data.vendas_mes = vendas;
        onboarding.step = 'primeira_venda';
        return `Ótimo, já entendi seu tamanho. Isso vai me ajudar a te entregar relatórios melhores.\n\nAgora vamos fazer seu primeiro teste rápido 😄\n\nMe envie uma venda da sua clínica, do jeitinho que você falaria para um amigo.`;
      }

      case 'primeira_venda': {
        // Verifica se pediu exemplo
        if (messageTrimmed.toLowerCase().includes('exemplo') || messageTrimmed.toLowerCase().includes('exemplo')) {
          return `Pode ser assim:\n\n"Júlia fez um full face com 12ml, usamos 10 Biogelis volume e 1 Juvederm. Total 15.600, pagou 3.000 no PIX e o resto em 6x no cartão."\n\nEu entendo tudo automaticamente.`;
        }

        // Processa a venda usando geminiService
        const geminiService = require('../services/geminiService');
        const intent = await geminiService.processMessage(messageTrimmed, {});
        
        if (intent.intencao === 'registrar_entrada' && intent.dados?.valor) {
          // Salva a primeira venda
          onboarding.data.primeira_venda = intent.dados;
          onboarding.step = 'primeiro_custo';
          
          // Confirma a venda
          const valor = intent.dados.valor.toFixed(2);
          const categoria = intent.dados.categoria || 'Procedimento';
          let confirmacao = `Entrada registrada! 🟣\n\n`;
          confirmacao += `• Valor: R$ ${valor}\n`;
          confirmacao += `• Categoria: ${categoria}\n`;
          if (intent.dados.nome_cliente) {
            confirmacao += `• Cliente: ${intent.dados.nome_cliente}\n`;
          }
          confirmacao += `\nAgora que já sei quanto entrou, bora ver o outro lado do financeiro?\n\nMe envie agora um custo da sua clínica — pode ser algo simples como uma compra de insumo, produto ou maquininha. Se quiser, pode mandar foto do boleto, PDF, nota fiscal ou até um texto.`;
          
          return confirmacao;
        } else {
          return `Não consegui entender essa venda 🤔\n\nPode me mandar de novo? Exemplo:\n\n"Botox 2800 cliente Maria"\n\nOu digite "exemplo" para ver um exemplo mais completo.`;
        }
      }

      case 'primeiro_custo': {
        // Processa o custo usando geminiService
        const geminiService = require('../services/geminiService');
        const intent = await geminiService.processMessage(messageTrimmed, {});
        
        if (intent.intencao === 'registrar_saida' && intent.dados?.valor) {
          onboarding.data.primeiro_custo = intent.dados;
          
          // Verifica se precisa perguntar sobre parcelamento
          if (!intent.dados.parcelas && intent.dados.forma_pagamento === 'parcelado') {
            onboarding.step = 'primeiro_custo_parcelas';
            return `Vi que você mencionou parcelamento. Em quantas vezes foi parcelado?`;
          }
          
          // Mostra resumo e pergunta se é fixo ou variável
          onboarding.step = 'primeiro_custo_tipo';
          const valor = intent.dados.valor.toFixed(2);
          const categoria = intent.dados.categoria || intent.dados.descricao || 'Custo';
          const quantidade = intent.dados.quantidade ? ` • Quantidade: ${intent.dados.quantidade} unidades` : '';
          const pagamento = intent.dados.forma_pagamento === 'parcelado' && intent.dados.parcelas 
            ? `${intent.dados.parcelas}x no Cartão`
            : intent.dados.forma_pagamento === 'pix' ? 'PIX'
            : intent.dados.forma_pagamento === 'dinheiro' ? 'Dinheiro'
            : 'Cartão';
          
          let resumo = `Show! Aqui está o que registrei:\n\n`;
          resumo += `• Descrição: ${categoria}${quantidade}\n`;
          resumo += `• Valor: R$ ${valor}\n`;
          resumo += `• Pagamento: ${pagamento}\n`;
          resumo += `• Categoria sugerida: Compra de insumo\n\n`;
          resumo += `Agora me diz: esse custo é fixo ou variável?\n\nDigite 1 para Variável ou 2 para Fixo`;
          
          return resumo;
        } else {
          return `Não consegui entender esse custo 🤔\n\nPode me mandar de novo? Exemplo:\n\n"Comprei 6 frascos de Biogeli, paguei 1.800 no cartão."`;
        }
      }

      case 'primeiro_custo_parcelas': {
        const parcelas = parseInt(messageTrimmed);
        if (isNaN(parcelas) || parcelas < 1) {
          return 'Por favor, digite o número de parcelas.';
        }
        onboarding.data.primeiro_custo.parcelas = parcelas;
        onboarding.step = 'primeiro_custo_tipo';
        
        const valor = onboarding.data.primeiro_custo.valor.toFixed(2);
        const categoria = onboarding.data.primeiro_custo.categoria || onboarding.data.primeiro_custo.descricao || 'Custo';
        const quantidade = onboarding.data.primeiro_custo.quantidade ? ` • Quantidade: ${onboarding.data.primeiro_custo.quantidade} unidades` : '';
        
        let resumo = `Show! Aqui está o que registrei:\n\n`;
        resumo += `• Descrição: ${categoria}${quantidade}\n`;
        resumo += `• Valor: R$ ${valor}\n`;
        resumo += `• Pagamento: ${parcelas}x no Cartão\n`;
        resumo += `• Categoria sugerida: Compra de insumo\n\n`;
        resumo += `Agora me diz: esse custo é fixo ou variável?\n\nDigite 1 para Variável ou 2 para Fixo`;
        
        return resumo;
      }

      case 'primeiro_custo_tipo': {
        const tipoNum = parseInt(messageTrimmed);
        if (tipoNum === 1) {
          onboarding.data.primeiro_custo.tipo_custo = 'variável';
          onboarding.step = 'segundo_custo';
          return `Perfeito! Lancei como custo variável. Isso me ajuda a entender melhor o comportamento financeiro da sua clínica 💜\n\nAgora falta só um custo fixo pra completar o seu painel inicial.\n\nMe envie algo como aluguel, software, salário, internet… o que for mais fácil pra você.`;
        } else if (tipoNum === 2) {
          // Se escolheu fixo, já pode ir para o resumo
          onboarding.data.primeiro_custo.tipo_custo = 'fixo';
          onboarding.step = 'resumo_final';
          // Processa o resumo final (cria usuário e mostra resumo)
          try {
            const result = await this.createUserFromOnboarding(onboarding.data);
            
            // Salva as transações registradas durante o onboarding
            await this.saveOnboardingTransactions(result.user.id, onboarding.data);
            
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

            const resumo = await this.buildResumoFinal(phone, onboarding, result.registrationLink);
            this.onboardingData.delete(phone);
            
            return resumo;
          } catch (error) {
            console.error('Erro ao criar usuário:', error);
            this.onboardingData.delete(phone);
            return `Erro ao criar cadastro 😢\n\n${error.message}\n\nTente novamente enviando qualquer mensagem.`;
          }
        } else {
          return 'Por favor, digite 1 para Variável ou 2 para Fixo.';
        }
      }

      case 'segundo_custo': {
        // Processa o segundo custo (fixo)
        const geminiService = require('../services/geminiService');
        const intent = await geminiService.processMessage(messageTrimmed, {});
        
        if (intent.intencao === 'registrar_saida' && intent.dados?.valor) {
          onboarding.data.segundo_custo = intent.dados;
          onboarding.data.segundo_custo.tipo_custo = 'fixo';
          onboarding.step = 'segundo_custo_confirmacao';
          
          const valor = intent.dados.valor.toFixed(2);
          const categoria = intent.dados.categoria || intent.dados.descricao || 'Custo';
          const pagamento = intent.dados.forma_pagamento === 'pix' ? 'PIX' : 'Cartão';
          
          return `Boa! Peguei aqui:\n\n• ${categoria} — R$ ${valor}\n• Pagamento: ${pagamento}\n\nLançar como custo fixo mensal?\n\nDigite 1 para Sim ou 2 para Não`;
        } else {
          return `Não consegui entender esse custo 🤔\n\nPode me mandar de novo? Exemplo:\n\n"Aluguel 5.000"`;
        }
      }

      case 'segundo_custo_confirmacao': {
        const confirmacao = parseInt(messageTrimmed);
        if (confirmacao === 1) {
          onboarding.step = 'resumo_final';
          // Processa o resumo final (cria usuário e mostra resumo)
          try {
            const result = await this.createUserFromOnboarding(onboarding.data);
            
            // Salva as transações registradas durante o onboarding
            await this.saveOnboardingTransactions(result.user.id, onboarding.data);
            
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

            const resumo = await this.buildResumoFinal(phone, onboarding, result.registrationLink);
            this.onboardingData.delete(phone);
            
            return resumo;
          } catch (error) {
            console.error('Erro ao criar usuário:', error);
            this.onboardingData.delete(phone);
            return `Erro ao criar cadastro 😢\n\n${error.message}\n\nTente novamente enviando qualquer mensagem.`;
          }
        } else if (confirmacao === 2) {
          return 'Ok, pode me enviar outro custo fixo então.';
        } else {
          return 'Por favor, digite 1 para Sim ou 2 para Não.';
        }
      }

      case 'resumo_final': {
        // Cria o usuário e finaliza
        try {
          const result = await this.createUserFromOnboarding(onboarding.data);
          
          // Salva as transações registradas durante o onboarding
          await this.saveOnboardingTransactions(result.user.id, onboarding.data);
          
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

          const resumo = await this.buildResumoFinal(phone, onboarding, result.registrationLink);
          this.onboardingData.delete(phone);
          
          return resumo;
        } catch (error) {
          console.error('Erro ao criar usuário:', error);
          this.onboardingData.delete(phone);
          return `Erro ao criar cadastro 😢\n\n${error.message}\n\nTente novamente enviando qualquer mensagem.`;
        }
      }

      // ========== FLUXO ANTIGO (FALLBACK) ==========
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
        onboarding.step = 'cnpj';

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

        return `*${messageTrimmed}* - nome bonito! 💜${progressText}\n\nAgora, se tiver o *CNPJ da clínica*, já me passa? Assim deixo tudo pronto.\n\nSe preferir, responda *Pular* ou *Prefiro não informar agora*.`;
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
    resumo += `• Receita cadastrada: R$ ${receitaTotal.toFixed(2)}\n`;
    resumo += `• Custos do mês (parciais):\n`;
    resumo += `  • Custos variáveis registrados: R$ ${custosVariaveis.toFixed(2)}\n`;
    resumo += `  • Custos fixos registrados: R$ ${custosFixos.toFixed(2)}\n`;
    resumo += `• Saldo inicial: R$ ${saldoInicial.toFixed(2)}\n\n`;
    resumo += `(esse saldo muda rápido conforme você registra suas vendas e custos reais)\n\n`;
    resumo += `Com mais dados, te mostro gráficos, histórico, totais, projeções e muito mais — tudo automaticamente 💜\n\n`;

    if (registrationLink) {
      resumo += `*CADASTRE-SE PARA ACESSO COMPLETO*\n\n`;
      resumo += `Clique no link abaixo para criar sua conta:\n\n`;
      resumo += `${registrationLink}\n\n`;
      resumo += `*O que acontece quando você se cadastrar:*\n`;
      resumo += `• Seu email será vinculado ao seu WhatsApp\n`;
      resumo += `• Você terá acesso completo a todos os recursos\n`;
      resumo += `• Todas as transações do WhatsApp ficarão sincronizadas\n\n`;
      resumo += `*Importante:*\n`;
      resumo += `• O link é válido por 48 horas\n`;
      resumo += `• Você pode continuar usando o WhatsApp normalmente enquanto isso\n\n`;
      resumo += `Assim que finalizar o cadastro, eu te aviso aqui no WhatsApp! 😊`;
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
}

module.exports = new UserController();
