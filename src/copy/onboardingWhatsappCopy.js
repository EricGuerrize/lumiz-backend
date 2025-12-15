/**
 * Copy module para onboarding via WhatsApp
 * Centraliza todas as mensagens para facilitar iterações de UX sem mexer em lógica
 */

module.exports = {
    introGreeting() {
        return (
            'Oi! Eu sou a Lumiz, sua assistente financeira para clínicas de estética. 💜\n' +
            'Em poucos minutos te ajudo a organizar receitas, custos e lucro da sua clínica — direto aqui no WhatsApp.'
        );
    },

    entryMenu() {
        return (
            `O que você quer fazer agora?\n\n` +
            `1️⃣ Entender como funciona\n` +
            `2️⃣ Começar meu cadastro\n\n` +
            `Responde com *1* ou *2* (ou escreve "entender" / "cadastro").`
        );
    },

    explainAndStartCadastro() {
        return (
            `Perfeito, vou te mostrar rapidinho como a Lumiz funciona 👇\n` +
            `1️⃣ Você manda suas *vendas, boletos e notas* por aqui.\n` +
            `2️⃣ Eu leio tudo sozinha e organizo em *receitas, custos e lucro*.\n` +
            `3️⃣ Você vê um resumo claro do financeiro da sua clínica — sem planilhas.\n\n` +
            `Pronto pra começar? 😊\n\n` +
            this.clinicTypeQuestion({ withProgress: true })
        );
    },

    clinicTypeQuestion({ withProgress = false } = {}) {
        const progress = withProgress ? `Etapa 1 de 4 ✅\n\n` : '';
        return (
            `${progress}Pra te ajudar direitinho, me conta:\n` +
            `Qual é o tipo da sua clínica?\n\n` +
            `1️⃣ Clínica de estética\n` +
            `2️⃣ Clínica odontológica\n` +
            `3️⃣ Outros procedimentos`
        );
    },

    clinicNameQuestion() {
        return (
            `Etapa 2 de 4 ✅\n\n` +
            `Ótimo! Agora, alguns dados rápidos:\n\n` +
            `✏️ *Nome da clínica* (pode ser o nome fantasia)`
        );
    },

    clinicCityQuestion() {
        return (
            `Perfeito ✅\n\n` +
            `Etapa 3 de 4\n\n` +
            `E qual cidade/UF você atende?\n` +
            `(Ex: Cuiabá – MT)`
        );
    },

    ownerQuestion() {
        return (
            `Etapa 4 de 4\n\n` +
            `Quem é o responsável pelas finanças da clínica?\n` +
            `Pode ser você mesmo(a) 😊\n\n` +
            `✏️ Me manda o *nome completo* e o *CPF/CNPJ*.`
        );
    },

    emailQuestion() {
        return (
            `Perfeito ✅\n\n` +
            `Só mais 2 dados e já partimos pro teste 😊\n\n` +
            `✉️ Qual seu melhor email?`
        );
    },

    whatsappQuestion() {
        return (
            `Qual seu WhatsApp para contato?\n` +
            `(Digite *este* para usar o atual)`
        );
    },

    cadastroOkAskFakeSale() {
        return (
            `Cadastro pronto! 🎉\n\n` +
            `Agora vamos fazer um teste rapidinho pra você ver a "mágica" acontecer.\n\n` +
            `Me manda uma *venda fictícia* nesse estilo:\n` +
            `*"Júlia fez um full face com 10ml, pagou R$ 5.000, cartão em 6x."*`
        );
    },

    cadastroSoftFailAskFakeSale() {
        return (
            `Perfeito ✅\n\n` +
            `Enquanto eu preparo sua conta por aqui, vamos fazer um teste rapidinho pra você ver como funciona.\n\n` +
            `Me manda uma *venda fictícia* nesse estilo:\n` +
            `*"Júlia fez um full face com 10ml, pagou R$ 5.000, cartão em 6x."*`
        );
    },

    fakeSalePrompt() {
        return (
            `Perfeito — vamos pro teste rápido ✅\n\n` +
            `Me manda uma *venda fictícia* nesse estilo:\n` +
            `*"Júlia fez um full face com 10ml, pagou R$ 5.000, cartão em 6x."*\n\n` +
            `Pode ser do seu jeito também. Eu só preciso entender: cliente, procedimento, valor e forma de pagamento.`
        );
    },

    fakeSaleAskAgain() {
        return (
            `Não consegui identificar o *valor* dessa venda 🤔\n\n` +
            `Tenta nesse formato:\n` +
            `*"Júlia fez um full face, pagou R$ 5000 no cartão em 6x"*`
        );
    },

    fakeSaleReview({ cliente, procedimento, valor, pagamentoLabel }) {
        return (
            `Entendi assim 👇\n` +
            `• Cliente: ${cliente ? `*${cliente}*` : '*—*'}\n` +
            `• Procedimento: ${procedimento ? `*${procedimento}*` : '*—*'}\n` +
            `• Valor total: *R$ ${Number(valor).toFixed(2)}*\n` +
            `• Pagamento: *${pagamentoLabel}*\n\n` +
            `Está certo?\n\n` +
            `1️⃣ Sim, pode registrar\n` +
            `2️⃣ Corrigir`
        );
    },

    fakeSaleCorrectionPrompt() {
        return (
            `Sem problema 😊\n\n` +
            `Me manda a venda de novo, corrigida (cliente + procedimento + valor + pagamento).`
        );
    },

    onboardingDoneMessage() {
        return (
            `Pronto! Essa venda já entrou no seu financeiro ✅\n\n` +
            `Se esse fosse seu mês de novembro, por exemplo, você veria algo assim:\n\n` +
            `📊 *Resumo Financeiro*\n` +
            `• *Receitas:* R$ 85.000\n` +
            `• *Custos:* R$ 32.000\n` +
            `• *Lucro:* R$ 53.000 (62%)\n\n` +
            `A qualquer momento, você pode pedir:\n` +
            `*"Lumiz, me dá um resumo financeiro do meu mês de novembro de 2025."*\n\n` +
            `Agora é com você! Pode começar a mandar suas vendas e custos reais. 😉`
        );
    },

    escalateToHuman() {
        return (
            'Sem problema, eu chamo alguém do time Lumiz pra falar com você aqui mesmo 😉\n\n' +
            'Em alguns minutos nossa equipe continua com você.'
        );
    },

    invalidEntryChoice() {
        return `Só pra eu seguir certinho: responde com *1* (entender) ou *2* (cadastro).`;
    }
};
