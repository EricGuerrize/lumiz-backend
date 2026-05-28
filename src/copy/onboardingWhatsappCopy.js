/**
 * Copy module para onboarding via WhatsApp
 * Centraliza todas as mensagens para facilitar iterações de UX sem mexer em lógica
 * Versão: Novo Fluxo Onboarding WhatsApp - Lumiz
 */

const { formatarMoeda } = require('../utils/currency');

module.exports = {
    // ============================================================
    // 0) START - Entrada do lead
    // ============================================================
    startMessage() {
        return (
            `Oi! Sou a Lumiz 👋 O financeiro da sua clínica, no WhatsApp.\n\n` +
            `Em 3 minutos você sabe quanto entrou hoje, sua margem real, o que tá vazando, e o que vale mudar.\n\n` +
            `Topa eu te mostrar como funciona?`
        );
    },

    startHowItWorks() {
        return (
            `Claro! A Lumiz é sua assistente financeira aqui no WhatsApp 💜\n\n` +
            `*Como funciona no dia a dia:*\n` +
            `Você me manda uma venda ou custo (texto, foto ou PDF). Eu organizo tudo automaticamente:\n` +
            `• Valor, forma de pagamento e parcelas\n` +
            `• Categorização automática (insumos, aluguel, procedimentos...)\n` +
            `• Resumo do mês: quanto entrou, saiu e sobrou\n\n` +
            `Sem planilhas. Sem apps extras. Tudo aqui no WhatsApp.\n\n` +
            `Ficou claro? Posso começar o teste rápido (3 minutinhos)?`
        );
    },

    // ============================================================
    // 1) CONSENT - Consentimento LGPD
    // ============================================================
    consentQuestion() {
        return (
            `Antes de começarmos: posso usar os dados que você me enviar aqui só pra organizar seu financeiro? Você pode parar quando quiser.\n\n` +
            `_(Responde "sim" pra autorizar ou "não" caso prefira não continuar)_`
        );
    },

    consentDenied() {
        return (
            `Puxa que pena — pra te mostrar como funciona na prática, preciso da sua confirmação.\n\n` +
            `Posso usar os dados que você me enviar aqui só pra organizar seu financeiro?`
        );
    },

    // ============================================================
    // 2) PROFILE - Identificação rápida
    // ============================================================
    profileNameQuestion() {
        return `Pra eu te chamar direitinho: qual seu nome?`;
    },

    profileClinicQuestion() {
        return `E o nome da sua clínica?`;
    },

    profileRoleQuestion() {
        return (
            `Você é a *dona/gestora* ou alguém do time?\n\n` +
            `(Dona/gestora, adm/financeiro, secretária ou profissional que aplica?)`
        );
    },

    // ============================================================
    // 2.5) PROFILE_ADD_MEMBER - Adicionar números da equipe
    // ============================================================
    profileAddMemberQuestion() {
        return (
            `Deseja cadastrar algum outro número da equipe pra acessar a Lumiz?\n` +
            `(Ex: o celular da dona, secretária, etc.)\n\n` +
            `Responde "sim" pra adicionar ou "não" pra fazer isso depois.`
        );
    },

    profileAddMemberRoleQuestion() {
        return (
            `Qual a função dessa pessoa?\n\n` +
            `(Dona/gestora, adm/financeiro, secretária ou profissional?)`
        );
    },

    profileAddMemberNameQuestion() {
        return `Qual o nome dessa pessoa?`;
    },

    profileAddMemberNameCorrection() {
        return (
            `Parece que você enviou um número de telefone no lugar do nome. 📱\n\n` +
            `Quer me mandar o nome dessa pessoa ou prefere continuar usando o número mesmo?`
        );
    },

    profileAddMemberPhoneQuestion() {
        return (
            `Qual o número de WhatsApp?\n` +
            `(Formato: 5511999999999)\n\n` +
            `💡 Se quiser corrigir o nome, digite "corrigir"`
        );
    },

    profileAddMemberSuccess(nome) {
        return (
            `✅ ${nome} cadastrado(a)!\n\n` +
            `Quer adicionar mais alguém? (Responde "sim" ou "não")`
        );
    },

    profileAddMemberInvalidPhone() {
        return (
            `Número inválido. Por favor, use o formato:\n` +
            `5511999999999 (código do país + DDD + número)`
        );
    },

    profileAddMemberAlreadyLinked(clinicName) {
        return (
            `⚠️ Este número já está vinculado à clínica "${clinicName}".\n` +
            `Quer adicionar outro número? (Responde "sim" ou "não")`
        );
    },

    // ============================================================
    // 3) CONTEXT_MIN - Contexto mínimo
    // ============================================================
    contextWhyQuestion() {
        return (
            `Hoje, você quer usar a Lumiz mais pra organizar o dia a dia, ter clareza do mês ou controlar custos?\n\n` +
            `_(Pode responder com suas palavras mesmo)_`
        );
    },

    contextPaymentQuestion() {
        return (
            `Em média, sua clínica recebe mais à vista (pix/dinheiro), no cartão parcelado ou meio a meio?`
        );
    },

    // Mantém alias para compatibilidade
    contextHowQuestion() {
        return this.contextPaymentQuestion();
    },

    // ============================================================
    // 4) AHA_REVENUE - Primeira venda
    // ============================================================
    ahaRevenuePrompt(nome) {
        return (
            `Perfeito, ${nome}. ✅\n\n` +
            `Agora vou te mostrar em 3 etapas como funcionamos\n` +
            `Me manda uma venda real, do jeito que você lembraria. Pode ser simples.\n\n` +
            `Exemplos:\n` +
            `• "Botox R$ 8.000 no pix hoje"\n` +
            `• "Júlia fez full face, pagou R$ 15.600. Sendo 3.000 pix + 6x cartão"`
        );
    },

    ahaRevenueMissingValue() {
        return `Qual foi o valor total?`;
    },

    ahaRevenueMissingPayment() {
        return `Foi PIX, cartão ou dinheiro?`;
    },

    ahaRevenueMissingInstallments() {
        return `No cartão, foi parcelado em quantas vezes?`;
    },

    ahaRevenueMissingDate() {
        return `Isso foi hoje ou em outra data?`;
    },

    ahaRevenueConfirmation({ procedimento, valor, pagamento, data, paciente, split }) {
        const pagamentoLabel = (() => {
            if (pagamento.includes('parcelado') || pagamento.includes('x')) {
                const match = pagamento.match(/(\d+)x/i);
                return match ? `Cartão ${match[1]}x` : pagamento;
            }
            const map = {
                pix: 'PIX',
                cartão: 'Cartão',
                cartao: 'Cartão',
                dinheiro: 'Dinheiro',
                debito: 'Débito',
                crédito: 'Crédito',
                credito: 'Crédito'
            };
            const lower = pagamento.toLowerCase();
            for (const [key, value] of Object.entries(map)) {
                if (lower.includes(key)) return value;
            }
            return pagamento;
        })();

        const splitText = Array.isArray(split) && split.length
            ? `Split: ${split.map((s) => {
                const metodo = s.metodo_label || s.metodo || 'Outro';
                const parcelaTxt = s.parcelas && s.parcelas > 1 ? ` ${s.parcelas}x` : '';
                return `${metodo}${parcelaTxt} ${formatarMoeda(Number(s.valor || 0))}`;
            }).join(' + ')}\n`
            : '';

        return (
            `💰 *VENDA*\n\n` +
            `Procedimento: ${procedimento || 'Procedimento'}\n` +
            `${paciente ? `Cliente: ${paciente}\n` : ''}` +
            `Valor total: ${formatarMoeda(Number(valor))}\n` +
            `Pagamento: ${pagamentoLabel}\n` +
            `${splitText}` +
            `Data: ${data}\n\n` +
            `Tá certo? Me diz se quiser ajustar alguma coisa.`
        );
    },

    ahaRevenueAdjustMenu() {
        return (
            `O que você quer ajustar? Pode me dizer o valor correto, a forma de pagamento, as parcelas ou o procedimento.`
        );
    },

    ahaRevenueRegistered() {
        return (
            `Venda registrada (teste) ✅\n\n` +
            `💡 Esta é apenas uma demonstração durante o onboarding.\n` +
            `As transações reais serão salvas apenas após você concluir o cadastro.`
        );
    },

    // ============================================================
    // 5) AHA_COSTS_INTRO - Introdução de custos
    // ============================================================
    ahaCostsIntro() {
        return (
            `Agora vem a parte que dá clareza de verdade: custos.\n\n` +
            `Me envie um custo, pode ser texto, foto ou PDF...`
        );
    },

    ahaCostsUploadPrompt() {
        return (
            `Me envie um custo, pode ser texto, foto ou PDF...`
        );
    },

    // Compatibilidade para retomada de onboarding com tipo pré-definido
    ahaCostsUploadFixed() {
        return (
            `Agora me manda um custo fixo (Ex: Aluguel, conta de luz).\n` +
            `Pode ser texto, foto ou PDF.`
        );
    },

    ahaCostsUploadVariable() {
        return (
            `Agora me manda um custo variável (Ex: Compra de insumos, injetáveis).\n` +
            `Pode ser texto, foto ou PDF.`
        );
    },

    ahaCostsClassify() {
        return (
            `Esse custo é fixo (acontece todo mês, como aluguel) ou variável (depende do mês, como insumos)?\n\n` +
            `_(Se não souber ao certo, me conta o que é o custo que eu classifico pra você)_`
        );
    },

    ahaCostsDontKnow() {
        return (
            `Tranquilo 👍\n\n` +
            `Me diz em uma frase o que é esse custo (ex: "aluguel da clínica" ou "compra de insumos"), que eu classifico pra você.`
        );
    },

    ahaCostsDocumentReceived({ valor, vencimento, fornecedor }) {
        return (
            `Recebi ✅ Vou organizar isso rapidinho.\n\n` +
            `Encontrei: ${formatarMoeda(Number(valor))}, vencimento ${vencimento}, fornecedor ${fornecedor || '—'}.\n\n` +
            `Esse custo é fixo (todo mês) ou variável (depende do mês)? _(Se não souber, me conta o que é que eu classifico)_`
        );
    },

    ahaCostsCategoryQuestionFixed() {
        return (
            `Beleza → fixo ✅\n\n` +
            `Pra eu organizar certinho, isso entra mais como:\n\n` +
            `• Aluguel\n` +
            `• Salários\n` +
            `• Internet / Utilitários (luz, água…)\n` +
            `• Marketing\n` +
            `• Impostos\n` +
            `• Outros\n\n` +
            `Qual se encaixa melhor?`
        );
    },

    ahaCostsCategoryQuestionVariable() {
        return (
            `Beleza → variável ✅\n\n` +
            `Pra eu organizar certinho, isso entra mais como:\n\n` +
            `• Insumos / materiais (luvas, máscara, touca, gaze…)\n` +
            `• Fornecedores de injetáveis (ácido hialurônico, toxina botulínica, bioestimuladores…)\n` +
            `• Outros\n\n` +
            `Qual se encaixa melhor?`
        );
    },

    ahaCostsConfirmation({ tipo, categoria, valor, data, pagamento, categoryTrigger }) {
        return (
            `💸 *CUSTO*\n\n` +
            `Tipo: ${tipo}\n` +
            `Categoria: ${categoria}\n` +
            `${categoryTrigger ? `Motivo: ${categoryTrigger}\n` : ''}` +
            `Valor: ${formatarMoeda(Number(valor))}\n` +
            `${pagamento ? `Pagamento: ${pagamento}\n` : ''}` +
            `Data: ${data}\n\n` +
            `Tá certo? Me diz se quiser ajustar alguma coisa.`
        );
    },

    ahaCostsRegistered() {
        return (
            `Custo registrado (teste) ✅`
        );
    },

    // Mensagens para pedir o segundo tipo de custo (complementar)
    ahaCostsSecondIntroFixed() {
        return (
            `Custo variável registrado ✅\n\n` +
            `Agora me manda um custo fixo (Ex: Aluguel, conta de luz).\n` +
            `Pode ser texto, foto ou PDF.`
        );
    },

    ahaCostsSecondIntroVariable() {
        return (
            `Custo fixo registrado ✅\n\n` +
            `Agora me manda um custo variável (Ex: Compra de insumos, injetaveis etc).\n` +
            `Pode ser texto, foto ou PDF.`
        );
    },

    // ============================================================
    // 7) AHA_SUMMARY - Resumo AHA
    // ============================================================
    ahaSummary({ entradas, custosFixos, custosVariaveis, saldoParcial }) {
        const entradasNum = Number(entradas) || 0;
        const saldoNum = Number(saldoParcial) || 0;
        const margem = entradasNum > 0 ? Math.round((saldoNum / entradasNum) * 100) : 0;
        return (
            `Pronto ✅\n\n` +
            `Olha que legal o resumo inicial:\n\n` +
            `📌 *Resumo parcial do mês:*\n\n` +
            `• Entradas: ${formatarMoeda(entradasNum)}\n` +
            `• Custos fixos: ${formatarMoeda(Number(custosFixos))}\n` +
            `• Custos variáveis: ${formatarMoeda(Number(custosVariaveis))}\n` +
            `• Resultado líquido: ${formatarMoeda(saldoNum)}\n\n` +
            `💡 *Insight rápido:* Com esse cenário de teste, seu resultado líquido seria de ${formatarMoeda(saldoNum)} — equivalente a ${margem}% de margem. Quando você começar a usar de verdade, esses insights aparecem em tempo real com os seus números.`
        );
    },

    // ============================================================
    // 7.5) BALANCE - Pergunta sobre saldo inicial
    // ============================================================
    balanceQuestion() {
        return (
            `Quer me mandar o saldo que você tem hoje pra eu ir ajustando?\n\n` +
            `_(Responde "sim" pra me mandar o valor, ou "não" pra seguirmos assim)_`
        );
    },

    balanceConfirmation(saldo) {
        return `Saldo registrado: ${formatarMoeda(Number(saldo))} ✅`;
    },

    balanceInputPrompt() {
        return 'Qual o saldo atual da clínica? (Ex: R$ 5.000)';
    },

    balanceInputInvalid() {
        return 'Não consegui identificar o valor. Pode me mandar novamente? (Ex: R$ 5.000)';
    },

    // ============================================================
    // 8) HANDOFF_TO_DAILY_USE - Uso diário
    // ============================================================
    handoffToDailyUse() {
        return (
            `Onboarding feito ✅\n\n` +
            `A partir de agora é só me mandar o que entra e sai da clínica — sem formulário, sem regra.\n\n` +
            `Exemplos: _"Recebi 1.500 no pix de fulana"_, _"Paguei 2.300 pro fornecedor"_, _"Quanto entrou esse mês?"_`
        );
    },

    onboardingCompletionNoMdr() {
        return `Tudo pronto! 🎉 Qualquer ajuste nas configurações é só me chamar.`;
    },

    trialClosingDecisionMaker(clinicName) {
        return (
            `Esse foi o teste da ${clinicName || 'sua clínica'} ✅\n\n` +
            `Pra usar de verdade, me responde *ASSINAR* ou *DÚVIDA*.`
        );
    },

    trialClosingTeamMember(clinicName) {
        return (
            `Pronto, esse foi o teste rápido da ${clinicName || 'clínica'}.\n\n` +
            `Como a continuação costuma passar pela dona/gestora, eu já te deixei abaixo um resumo pronto pra encaminhar. ` +
            `Assim você não precisa montar nada do zero.`
        );
    },

    trialForwardSummary(summaryText) {
        return (
            `Toma, é só copiar e mandar:\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `${summaryText}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `Se ela se interessar, é só me chamar aqui que eu sigo com o próximo passo.`
        );
    },

    dashboardAccessLink(link) {
        return (
            `Para acessar o dashboard, abra o link abaixo (válido por 24h):\n` +
            `${link}\n\n` +
            `Use o e-mail (ou telefone) e a senha que você escolher para entrar.`
        );
    },

    // ============================================================
    // 9) MDR_SETUP - Taxas da maquininha
    // ============================================================
    mdrSetupIntro() {
        return (
            `Só mais um detalhe pra deixar seu caixa sem surpresas no fim do mês!\n\n` +
            `Como muita venda em clínica é no cartão parcelado, as taxas MDR comem uma fatia do valor que cai na conta.\n\n` +
            `Configurando isso, eu já mostro pra você o valor líquido real em cada venda.\n` +
            `Exemplo: "Uma venda de R$ 1.500 em 3x no cartão → cai R$ 460 por mês na conta, já com as taxas MDR descontadas."\n\n` +
            `Assim o caixa fica mais previsível!\n\n` +
            `Quer configurar as taxas do seu cartão agora ou prefere pular por enquanto?`
        );
    },

    mdrSetupSkip() {
        return (
            `Sem problema 👍\n` +
            `Por enquanto, vou te mostrar uma visão mais bruta das vendas no cartão.\n\n` +
            `Quando quiser configurar depois, é só dizer:\n` +
            `"Lumiz, quero configurar minhas taxas."`
        );
    },

    mdrSetupQuestion() {
        return `Quantas maquininhas ou bancos você usa pra receber cartão?`;
    },

    mdrSetupUpload() {
        return (
            `Entra no app da maquininha, abre a tabela de taxas e tira um print.\n` +
            `Pode me mandar aqui que registro automático.`
        );
    },

    mdrSetupReinforcement() {
        return (
            `Assim eu consigo entender:\n\n` +
            `• que parte do dinheiro entra na hora\n` +
            `• que parte entra depois\n` +
            `• e quanto realmente cai no caixa`
        );
    },

    mdrSetupComplete() {
        return (
            `Pronto ✅\n` +
            `Agora seu caixa reflete melhor a realidade do dia a dia.`
        );
    },

    // ============================================================
    // Utilitários e mensagens de erro
    // ============================================================
    escalateToHuman() {
        return (
            'Sem problema, eu chamo alguém do time Lumiz pra falar com você aqui mesmo 😉\n\n' +
            'Em alguns minutos nossa equipe continua com você.'
        );
    },

    invalidChoice(menu) {
        const base = `Só pra eu seguir certinho: responde com uma das opções 👇`;
        return menu ? `${base}\n\n${menu}` : base;
    },

    // ============================================================
    // Mensagens de erro e validação
    // ============================================================
    nameTooShort() {
        return 'Nome muito curto. Digite novamente:';
    },

    clinicNameTooShort() {
        return 'Nome da clínica muito curto. Digite novamente:';
    },

    costValueNotFound() {
        return 'Não consegui identificar o valor desse custo. Pode me mandar o valor? (ex: R$ 500)';
    },

    costErrorRetry() {
        return 'Ops, algo deu errado. Pode me mandar o custo novamente?';
    },

    userCreationError() {
        return 'Ops, tive um problema ao criar sua conta. Pode tentar novamente? Se o problema continuar, me avise que eu chamo alguém do time.';
    },

    mdrInvalidNumber() {
        return 'Preciso de um número válido. Quantas maquininhas você usa?';
    },

    mdrNeedPhoto() {
        return 'Preciso do print da tabela de taxas. Pode me mandar uma foto?';
    },

    lostState() {
        return 'Ops, me perdi. Digite "Oi" para recomeçar.';
    },

    handoffRegisterSale() {
        return 'Perfeito! Me manda a venda que eu registro. 😊';
    },

    handoffRegisterCost() {
        return 'Beleza! Me manda o custo que eu registro. 😊';
    },

    handoffShowSummary() {
        return 'Claro! Vou te mostrar o resumo do mês. 😊';
    },

    documentReceivedMessage({ valor, vencimento, fornecedor }) {
        return (
            `Recebi ✅ Vou organizar isso rapidinho.\n\n` +
            `Encontrei: ${formatarMoeda(Number(valor))}, vencimento ${vencimento || '—'}, fornecedor ${fornecedor || '—'}.\n\n` +
            `Esse custo é fixo (todo mês) ou variável (depende do mês)?`
        );
    },

    documentReceivedSimple({ valor }) {
        return (
            `Recebi ✅ Vou organizar isso rapidinho.\n\n` +
            `Encontrei: ${formatarMoeda(Number(valor))}.`
        );
    },

    mdrPrintReceived({ current, total }) {
        return (
            `Print ${current} recebido ✅\n\n` +
            `Agora me manda o print da maquininha ${current + 1} de ${total}:`
        );
    },

    // ============================================================
    // Mensagens de erro críticas
    // ============================================================
    revenueSaveError() {
        return (
            'Ops, tive um problema ao registrar sua venda 😔\n\n' +
            'Pode tentar de novo? Se o problema continuar, me avise que eu chamo alguém do time.'
        );
    },

    costSaveError() {
        return (
            'Ops, tive um problema ao registrar seu custo 😔\n\n' +
            'Pode tentar de novo? Se o problema continuar, me avise que eu chamo alguém do time.'
        );
    },

    documentProcessError() {
        return (
            'Não consegui processar esse documento 🤔\n\n' +
            'Pode me mandar o valor e descrição em texto?\n\n' +
            'Exemplo: _"Insumos R$ 500"_'
        );
    },

    invalidName() {
        return 'Nome inválido. Por favor, digite um nome real (com letras).';
    },

    invalidClinicName() {
        return 'Nome da clínica inválido. Por favor, digite um nome real (com letras).';
    },

    valueTooHigh() {
        return 'Valor muito alto. O máximo é R$ 10.000.000. Pode verificar e tentar novamente?';
    },

    valueTooLow() {
        return 'Valor muito baixo. O mínimo é R$ 0,01. Pode verificar e tentar novamente?';
    },

    valueInvalid() {
        return 'Valor inválido. Por favor, digite um valor válido (ex: R$ 500 ou 1500.50).';
    },

    // ============================================================
    // Gerenciamento de Membros (pós-onboarding)
    // ============================================================
    addMemberStart() {
        return (
            `Vou te ajudar a cadastrar um novo número! 📱\n\n` +
            `Qual a função dessa pessoa? (Dona/gestora, adm/financeiro, secretária ou profissional?)`
        );
    },

    addMemberNoPermission() {
        return `⚠️ Apenas donos/gestoras podem adicionar novos números à clínica.`;
    },

    addMemberNameQuestion() {
        return `Qual o nome dessa pessoa?`;
    },

    addMemberPhoneQuestion() {
        return (
            `Qual o número de WhatsApp dessa pessoa?\n` +
            `(Formato: 5511999999999)`
        );
    },

    addMemberSuccess(nome, funcao) {
        return (
            `✅ ${nome} foi cadastrado(a) como ${funcao}!\n\n` +
            `Quando essa pessoa enviar uma mensagem, ela receberá uma confirmação ` +
            `e terá acesso aos dados financeiros da clínica.`
        );
    },

    addMemberPhoneAlreadyLinked(clinicName) {
        return `⚠️ Este número já está vinculado à clínica "${clinicName}".`;
    },

    // ============================================================
    // Confirmação de Número Secundário
    // ============================================================
    secondaryNumberConfirmation(clinicName, addedByName) {
        return (
            `Olá! 👋\n\n` +
            `Você foi adicionado(a) à clínica *${clinicName}* por ${addedByName}.\n\n` +
            `Confirma o vínculo para ter acesso aos dados financeiros?\n\n` +
            `_(Responde "confirmo" ou "não sou dessa clínica")_`
        );
    },

    secondaryNumberConfirmed(clinicName) {
        return (
            `✅ Vínculo confirmado!\n\n` +
            `Agora você tem acesso aos dados financeiros da clínica *${clinicName}*.\n\n` +
            `Pode me mandar vendas, custos ou pedir resumos. 😊`
        );
    },

    secondaryNumberRejected() {
        return (
            `Ok, vínculo cancelado.\n\n` +
            `Se isso foi um engano, peça para a dona/gestora da clínica te adicionar novamente.`
        );
    },

    // ============================================================
    // Remoção de Membros
    // ============================================================
    removeMemberNoPermission() {
        return (
            `⚠️ Apenas a dona ou gestora da clínica pode remover números.\n\n` +
            `Se você precisa remover alguém, peça para quem tem permissão fazer isso.`
        );
    },

    removeMemberConfirmation(nome, telefone) {
        return (
            `⚠️ Tem certeza que deseja remover *${nome}*?\n` +
            `📞 ${telefone}\n\n` +
            `Essa pessoa perderá acesso aos dados financeiros da clínica.\n\n` +
            `_(Responde "sim, remover" para confirmar ou "cancelar" para desistir)_`
        );
    },

    removeMemberSuccess(nome) {
        return (
            `✅ *${nome}* foi removido(a) com sucesso!\n\n` +
            `Essa pessoa não tem mais acesso aos dados financeiros da clínica.`
        );
    },

    // ============================================================
    // Transferência de Número entre Clínicas
    // ============================================================
    transferConfirmationToOwner(phone, newClinicName) {
        return (
            `⚠️ Aviso importante!\n\n` +
            `O número ${phone} está sendo transferido para a clínica "${newClinicName}".\n\n` +
            `Confirma a remoção deste número da sua clínica?\n\n` +
            `_(Responde "sim, pode transferir" para confirmar ou "não, manter" para cancelar)_`
        );
    },

    transferApproved() {
        return `✅ Transferência autorizada.`;
    },

    transferDenied() {
        return `❌ Transferência negada. O número permanece vinculado à sua clínica.`;
    },

    // ============================================================
    // Funções legadas (mantidas para compatibilidade)
    // ============================================================
    introGreeting() {
        return this.startMessage();
    },

    entryMenu() {
        return this.startMessage();
    },

    // ============================================================
    // REDESIGN 5 ATOS (Fase 15)
    // Novos usuários: ACT1_START → ACT2_SALE → ACT2_SALE_CONFIRM
    //                → ACT3_COST → ACT3_COST_CONFIRM → ACT4_AHA → ACT5_CTA
    // ============================================================

    /** Ato 1 — Boas-vindas + permissão para começar */
    act1Welcome() {
        return (
            `Oi! Sou a Lumiz, sua CFO no WhatsApp 💜\n\n` +
            `Vou montar um mini raio-x financeiro usando uma venda real da clínica: receita, custo, taxa de cartão e margem.\n\n` +
            `Sem planilha e sem cadastro longo. Posso começar?`
        );
    },

    act1RoleUnrecognized() {
        return `Me responde com *sim* para eu montar o primeiro raio-x financeiro da clínica aqui no WhatsApp.`;
    },

    /** Ato 2 — Primeira venda */
    act2SalePrompt() {
        return (
            `Perfeito. Primeiro, me manda uma *venda real* desta semana 💰\n\n` +
            `Pode escrever natural, do jeito que falaria no balcão:\n` +
            `_"botox R$ 2.500 no crédito em 2x"_`
        );
    },

    act2SaleConfirm(procedimento, valor, pagamento) {
        const valorFmt = typeof valor === 'number'
            ? `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
            : String(valor || '?');
        return (
            `Receita-base do diagnóstico:\n` +
            `*${procedimento || 'Procedimento'}* — ${valorFmt}` +
            (pagamento ? ` no ${pagamento}` : '') +
            `.\n\n` +
            `Está certo? Se tiver algo diferente, pode corrigir em uma frase.`
        );
    },

    act2PaymentPrompt() {
        return `Qual foi a forma de pagamento dessa venda? PIX, dinheiro, débito ou crédito? Se foi parcelado, pode mandar tipo _"3x no cartão"_.`;
    },

    act2SaleMissingValue(procedimento) {
        return (
            `Entendi o procedimento${procedimento ? `: *${procedimento}*` : ''}.\n\n` +
            `Agora me manda o valor da venda e, se lembrar, a forma de pagamento.\n` +
            `Exemplo: _"R$ 2.500 no crédito em 2x"_`
        );
    },

    act2MdrRatePrompt() {
        return (
            `Boa. Como foi no cartão, tem uma parte importante: *taxa da maquininha*.\n\n` +
            `Você sabe a taxa dessa venda? Pode responder tipo _"3,2%"_.\n` +
            `Se não souber, manda _"não sei"_ que eu uso uma estimativa conservadora.`
        );
    },

    act2MdrRateUnrecognized() {
        return `Me manda a taxa em percentual, tipo _"3,2%"_, ou responde _"não sei"_ para eu seguir com uma estimativa.`;
    },

    act2SaleAdjust() {
        return `Ok! Me manda o valor e a forma de pagamento corrigidos:`;
    },

    act2SaleAmbiguous() {
        return (
            `Quase lá. Pra eu não registrar errado, me manda a venda com *procedimento + valor + forma de pagamento*.\n\n` +
            `Exemplo: _"botox R$ 2.500 no crédito em 2x"_`
        );
    },

    /** Ato 3 — Primeiro custo */
    act3CostPrompt() {
        return (
            `Agora vamos cruzar essa venda com um custo real 💸\n\n` +
            `Pode mandar a *nota fiscal* em foto/PDF ou digitar o principal custo ligado ao procedimento:\n` +
            `_"toxina R$ 800"_ ou _"luvas R$ 500"_`
        );
    },

    act3CostConfirm(descricao, valor) {
        const valorFmt = typeof valor === 'number'
            ? `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
            : String(valor || '?');
        return (
            `Custo identificado:\n` +
            `*${descricao || 'Custo'}* — ${valorFmt}.\n\n` +
            `Confirma? Se não for isso, me manda a correção.`
        );
    },

    act3CostDocumentError() {
        return `Não consegui ler o valor da nota com segurança 🤔 Pode mandar de novo com uma foto mais nítida ou digitar assim: _"Insumos R$ 800"_.`;
    },

    act3CostAdjust() {
        return `Ok! Me manda o custo correto:`;
    },

    act3CostMissingValue(descricao) {
        return (
            `Entendi o custo${descricao ? `: *${descricao}*` : ''}.\n\n` +
            `Agora me manda o valor aproximado.\n` +
            `Exemplo: _"R$ 800"_`
        );
    },

    act3CostUnknown() {
        return (
            `Sem problema. Para esse primeiro raio-x, pode ser uma estimativa aproximada.\n\n` +
            `Exemplo: _"toxina uns R$ 800"_ ou _"não lembro, usa R$ 500"_.`
        );
    },

    /** Ato 4 — AHA insight */
    act4Aha({ procedimento, receita, custo, margemBruta, margemPercent, insumoPercent, insumoMin, insumoMax, liquidoPix, liquidoCredito, taxaCredito, rateConfidence }) {
        const receitaFmt = receita != null ? `R$ ${Number(receita).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null;
        const custoFmt = custo != null ? `R$ ${Number(custo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null;
        const margemFmt = margemBruta != null ? `R$ ${Number(margemBruta).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null;
        const liquidoPixFmt = liquidoPix != null ? `R$ ${Number(liquidoPix).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null;
        const liquidoCreditoFmt = liquidoCredito != null ? `R$ ${Number(liquidoCredito).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null;
        const resumoLine = receitaFmt && custoFmt
            ? `\n• Receita analisada: *${receitaFmt}*\n• Custo informado: *${custoFmt}*`
            : '';
        const insumoLine = insumoPercent != null
            ? `\n• Peso do custo: *${insumoPercent}% da receita* — ${insumoPercent >= insumoMin && insumoPercent <= insumoMax ? 'dentro da faixa saudável' : 'fora da faixa recomendada'} (${insumoMin}-${insumoMax}% como referência inicial).`
            : '';

        const creditoLine = liquidoCreditoFmt
            ? (rateConfidence === 'estimate'
                ? `\n• Após taxa de cartão estimada (${taxaCredito}%): *~${liquidoCreditoFmt}* entra líquido.`
                : `\n• Após taxa da maquininha (${taxaCredito}%): *~${liquidoCreditoFmt}* entra líquido.`)
            : '';

        const pixLine = liquidoPixFmt ? `\n• Recebimento líquido: *${liquidoPixFmt}*.` : '';
        const margemLine = margemFmt
            ? `\n• Margem estimada depois desse custo: *${margemFmt}*${margemPercent != null ? ` (${margemPercent}%)` : ''}.`
            : '';

        return (
            `Aqui está o primeiro raio-x financeiro desse ${procedimento || 'procedimento'} 🎯` +
            resumoLine +
            insumoLine +
            pixLine +
            creditoLine +
            margemLine +
            `\n\nEsse é o tipo de leitura que a Lumiz vai montar automaticamente para cada lançamento. Quer continuar por aqui no WhatsApp?`
        );
    },

    /** Ato 5 — encerramento */
    act5CtaOwner(summary = {}) {
        summary = summary || {};
        const receitaFmt = summary.receita != null ? formatarMoeda(Number(summary.receita)) : null;
        const custoFmt = summary.custo != null ? formatarMoeda(Number(summary.custo)) : null;
        const margemFmt = summary.margemBruta != null ? formatarMoeda(Number(summary.margemBruta)) : null;
        const pagamentoLine = summary.pagamento
            ? ` no ${summary.pagamento}${summary.parcelas && summary.parcelas > 1 ? ` em ${summary.parcelas}x` : ''}`
            : '';
        const taxaFmt = summary.taxaCredito != null
            ? Number(summary.taxaCredito).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
            : null;
        const taxaLine = summary.taxaCredito != null && summary.taxaCredito > 0
            ? `\n• taxa considerada: *${taxaFmt}%*${summary.rateConfidence === 'estimate' ? ' (estimativa)' : ''}`
            : '';
        const snapshot = receitaFmt
            ? (
                `Hoje eu já organizei:\n` +
                `• venda: *${summary.procedimento || 'Procedimento'}* — *${receitaFmt}*${pagamentoLine}\n` +
                (custoFmt ? `• custo informado: *${summary.custoDescricao || 'Custo'}* — *${custoFmt}*` : '') +
                taxaLine +
                (margemFmt ? `\n• margem estimada: *${margemFmt}*${summary.margemPercent != null ? ` (${summary.margemPercent}%)` : ''}` : '') +
                `\n\n`
            )
            : '';

        return (
            `Perfeito. Seu primeiro raio-x financeiro está pronto ✅\n\n` +
            snapshot +
            `A partir de agora, a Lumiz pode acompanhar a rotina financeira da clínica direto por aqui.\n\n` +
            `Nos próximos 30 dias, você pode testar a experiência completa:\n` +
            `• lançar receitas e despesas por texto, áudio, foto ou PDF;\n` +
            `• enviar notas fiscais, boletos e comprovantes;\n` +
            `• consultar saldo, entradas, custos e insights;\n` +
            `• acompanhar margem por procedimento e impacto das taxas de maquininha.\n\n` +
            `Por enquanto, vamos deixar seus lançamentos bem organizados no WhatsApp. ` +
            `Quando a próxima etapa da plataforma estiver pronta, eu te aviso por aqui.`
        );
    },

    act5CtaDeclined(summary = {}) {
        summary = summary || {};
        const receitaFmt = summary.receita != null ? formatarMoeda(Number(summary.receita)) : null;
        const custoFmt = summary.custo != null ? formatarMoeda(Number(summary.custo)) : null;
        const resumoLine = receitaFmt
            ? (
                `Eu já organizei a venda de *${summary.procedimento || 'procedimento'}* (${receitaFmt})` +
                (custoFmt ? ` e o custo de *${summary.custoDescricao || 'custo'}* (${custoFmt})` : '') +
                `.\n\n`
            )
            : '';

        return (
            `Sem problema. Já deixei esse primeiro raio-x financeiro salvo ✅\n\n` +
            resumoLine +
            `A partir daqui, você pode continuar usando a Lumiz direto por aqui: mande receitas, custos, notas, boletos ou dúvidas financeiras da clínica.\n\n` +
            `Nos próximos 30 dias, vou te ajudar a organizar os lançamentos e enxergar margem, custos e taxas com mais clareza.`
        );
    },

    act5CtaTeam() {
        return (
            `Legal! Que tal a gente mostrar isso pra dona da clínica? 🤝\n\n` +
            `Posso montar um resuminho financeiro pra você encaminhar pra ela. Quer?`
        );
    },

    dashboardTeaserVideoCaption() {
        return (
            `Um spoiler do que está vindo: o dashboard da Lumiz vai reunir seus lançamentos e insights em uma visão mais visual.\n\n` +
            `Por enquanto, seguimos deixando tudo redondo por aqui no WhatsApp.`
        );
    }
};
