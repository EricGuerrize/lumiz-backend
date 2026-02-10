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
            `Oi! Eu sou a Lumiz 👋 Eu organizo o financeiro da sua clínica aqui no WhatsApp, sem planilhas.\n\n` +
            `Pra te mostrar como a Lumiz vira seu organizador financeiro diário, vamos fazer um teste rápido de 3 minutos.\n\n` +
            `Posso começar?\n\n` +
            `1️⃣ Sim!\n` +
            `2️⃣ Como a Lumiz funciona?`
        );
    },

    startHowItWorks() {
        return (
            `Em 3 minutos você me manda 1 venda e 1 custo (texto, foto ou PDF).\n` +
            `Eu organizo tudo e já te mostro quanto entrou e quanto saiu.\n\n` +
            `Posso começar?\n\n` +
            `1️⃣ Sim!\n` +
            `2️⃣ Como a Lumiz funciona?`
        );
    },

    // ============================================================
    // 1) CONSENT - Consentimento LGPD
    // ============================================================
    consentQuestion() {
        return (
            `Antes de começarmos: posso usar os dados que você me enviar aqui só pra organizar seu financeiro? Você pode parar quando quiser.\n\n` +
            `1️⃣ Autorizo\n` +
            `2️⃣ Não`
        );
    },

    consentDenied() {
        return (
            `Puxa que pena, para você ver na prática como vamos mudar seu dia a dia, preciso da sua confirmação.\n\n` +
            `Posso usar os dados que você me enviar aqui só pra organizar seu financeiro?\n\n` +
            `1️⃣ Autorizo\n` +
            `2️⃣ Não`
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
            `Você é a dona/gestora ou alguém do time?\n\n` +
            `1️⃣ 👑 Dona / gestora\n` +
            `2️⃣ 🧾 Adm / financeiro\n` +
            `3️⃣ 💬 Secretária\n` +
            `4️⃣ ⚕️ Profissional (aplico)`
        );
    },

    // ============================================================
    // 2.5) PROFILE_ADD_MEMBER - Adicionar números da equipe
    // ============================================================
    profileAddMemberQuestion() {
        return (
            `Deseja cadastrar algum outro número da equipe pra acessar a Lumiz?\n` +
            `(Ex: o celular da dona, secretária, etc.)\n\n` +
            `1️⃣ Sim, quero adicionar\n` +
            `2️⃣ Não, depois faço isso`
        );
    },

    profileAddMemberRoleQuestion() {
        return (
            `Qual a função dessa pessoa?\n\n` +
            `1️⃣ 👑 Dona / gestora\n` +
            `2️⃣ 🧾 Adm / financeiro\n` +
            `3️⃣ 💬 Secretária\n` +
            `4️⃣ ⚕️ Profissional`
        );
    },

    profileAddMemberNameQuestion() {
        return `Qual o nome dessa pessoa?`;
    },

    profileAddMemberNameCorrection() {
        return (
            `Parece que você enviou um número de telefone no lugar do nome. 📱\n\n` +
            `O que você prefere fazer?\n\n` +
            `1️⃣ Corrigir e enviar o nome\n` +
            `2️⃣ Continuar (usar o número como nome)`
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
            `Deseja adicionar mais alguém?\n\n` +
            `1️⃣ Sim, mais um\n` +
            `2️⃣ Não, vamos continuar`
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
            `Deseja adicionar outro número?\n\n` +
            `1️⃣ Sim\n` +
            `2️⃣ Não`
        );
    },

    // ============================================================
    // 3) CONTEXT_MIN - Contexto mínimo
    // ============================================================
    contextWhyQuestion() {
        return (
            `Hoje, você quer usar a Lumiz mais pra:\n\n` +
            `1️⃣ Organizar o dia a dia\n` +
            `2️⃣ Ter clareza do mês\n` +
            `3️⃣ Controlar custos`
        );
    },

    contextPaymentQuestion() {
        return (
            `Em média, sua clínica recebe mais por:\n\n` +
            `1️⃣ PIX\n` +
            `2️⃣ Cartão\n` +
            `3️⃣ Boleto\n` +
            `4️⃣ Outros`
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
            `• "Botox R$ 1.200 no pix hoje"\n` +
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

    ahaRevenueConfirmation({ procedimento, valor, pagamento, data }) {
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

        return (
            `Vou registrar assim:\n` +
            `Venda: ${procedimento || '—'} — ${formatarMoeda(Number(valor))} — ${pagamentoLabel} — ${data}\n\n` +
            `Tá ok?\n\n` +
            `1️⃣ Tá ok\n` +
            `2️⃣ ✏️ Ajustar`
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

    ahaCostsClassify() {
        return (
            `Esse custo é mais:\n\n` +
            `1️⃣ 🧱 Fixo (todo mês)\n` +
            `2️⃣ 🧪 Variável (depende do mês)\n` +
            `3️⃣ Não sei`
        );
    },

    ahaCostsDocumentReceived({ valor, vencimento, fornecedor }) {
        return (
            `Recebi ✅ Vou organizar isso rapidinho.\n\n` +
            `Encontrei: ${formatarMoeda(Number(valor))}, vencimento ${vencimento}, fornecedor ${fornecedor || '—'}.\n` +
            `Isso é um custo fixo ou variável?\n\n` +
            `1️⃣ Fixo\n` +
            `2️⃣ Variável\n` +
            `3️⃣ Não sei`
        );
    },

    ahaCostsCategoryQuestionFixed() {
        return (
            `Beleza → fixo ✅\n\n` +
            `Pra eu organizar certinho, isso entra mais como:\n\n` +
            `1️⃣ Aluguel\n` +
            `2️⃣ Salários\n` +
            `3️⃣ Internet / Utilitários (luz, água…)\n` +
            `4️⃣ Marketing\n` +
            `5️⃣ Impostos\n` +
            `6️⃣ Outros`
        );
    },

    ahaCostsCategoryQuestionVariable() {
        return (
            `Beleza → variável ✅\n\n` +
            `Pra eu organizar certinho, isso entra mais como:\n\n` +
            `1️⃣ Insumos / materiais (Ex: luvas, máscara, touca, gaze…)\n` +
            `2️⃣ Fornecedores de injetáveis (Ex: ácido hialurônico, toxina botulínica, bioestimuladores…)\n` +
            `3️⃣ Outros`
        );
    },

    ahaCostsConfirmation({ tipo, categoria, valor, data }) {
        return (
            `Registrando: ${tipo} — ${categoria} — ${formatarMoeda(Number(valor))} — ${data}\n` +
            `Confere?\n\n` +
            `1️⃣ Confere\n` +
            `2️⃣ Ajustar`
        );
    },

    ahaCostsRegistered() {
        return (
            `Custo registrado (teste) ✅\n\n` +
            `💡 Esta é apenas uma demonstração durante o onboarding.\n` +
            `As transações reais serão salvas apenas após você concluir o cadastro.`
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
        return (
            `Pronto ✅\n\n` +
            `Olha que legal o resumo inicial:\n\n` +
            `📌 *Resumo parcial do mês:*\n\n` +
            `• Entradas: ${formatarMoeda(Number(entradas))}\n` +
            `• Custos fixos: ${formatarMoeda(Number(custosFixos))}\n` +
            `• Custos variáveis: ${formatarMoeda(Number(custosVariaveis))}\n` +
            `• Saldo parcial: ${formatarMoeda(Number(saldoParcial))}\n\n` +
            `ℹ️ Esse saldo parcial é só uma referência do que passou por aqui até agora. Ele pode não bater exatamente com o que você vê no banco, e tá tudo bem.`
        );
    },

    // ============================================================
    // 7.5) BALANCE - Pergunta sobre saldo inicial
    // ============================================================
    balanceQuestion() {
        return (
            `Quer me mandar o saldo que você tem hoje pra eu ir ajustando?\n\n` +
            `1️⃣ Sim, vou mandar\n` +
            `2️⃣ Não agora, seguimos assim`
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
            `Agora é só me usar no dia a dia.\n` +
            `Não tem regra nem formulário.\n` +
            `Tudo que entrar ou sair da clínica, me manda aqui.\n\n` +
            `Exemplos:\n\n` +
            `"Recebi 1.500 no pix hoje de fulana, que fez tal procedimento"\n\n` +
            `"Paguei parcela do fornecedor 2.300"\n\n` +
            `"Quanto entrou esse mês?"\n\n` +
            `"O que ainda falta cair?"\n\n` +
            `Para gerenciar os números da equipe, use o dashboard em Configurações/Integrações.\n\n` +
            `Quanto mais você me usa, melhor eu entendo sua rotina e mais claros ficam seus números!\n` +
            `Vamos nessa juntos?`
        );
    },

    onboardingCompletionNoMdr() {
        return (
            `Configuração 100% finalizada! 🎉 Sua clínica está pronta e sem planilhas. ` +
            `Caso queira ajustar ou adicionar algo nas configurações, só me chamar!\n\n` +
            `Bora pra primeira venda real do dia? Se tiver algo que rolou hoje, já pode mandar!`
        );
    },

    dashboardAccessLink(link) {
        return (
            `Seu dashboard já está liberado ✅\n\n` +
            `Crie seu acesso por este link (válido por 24h):\n` +
            `${link}\n\n` +
            `Depois você poderá entrar com email+senha ou telefone+senha.`
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
            `Quer configurar as taxas do seu cartão agora?\n\n` +
            `1️⃣ Configurar agora\n` +
            `2️⃣ Pular por enquanto`
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

    invalidChoice() {
        return `Só pra eu seguir certinho: responde com uma das opções acima.`;
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
            `Encontrei: ${formatarMoeda(Number(valor))}, vencimento ${vencimento || '—'}, fornecedor ${fornecedor || '—'}.\n` +
            `Isso é um custo fixo ou variável?\n\n` +
            `1️⃣ Fixo\n` +
            `2️⃣ Variável`
        );
    },

    documentReceivedSimple({ valor }) {
        return (
            `Recebi ✅ Vou organizar isso rapidinho.\n\n` +
            `Encontrei: ${formatarMoeda(Number(valor))}.\n` +
            `Isso é um custo fixo ou variável?\n\n` +
            `1️⃣ Fixo\n` +
            `2️⃣ Variável`
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
            `Qual a função dessa pessoa?\n\n` +
            `1️⃣ 👑 Dona / gestora\n` +
            `2️⃣ 🧾 Adm / financeiro\n` +
            `3️⃣ 💬 Secretária\n` +
            `4️⃣ ⚕️ Profissional`
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
            `1️⃣ Sim, confirmo\n` +
            `2️⃣ Não, não sou dessa clínica`
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
            `1️⃣ Sim, remover\n` +
            `2️⃣ Não, cancelar`
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
            `1️⃣ Sim, pode transferir\n` +
            `2️⃣ Não, manter vinculado aqui`
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
    }
};
