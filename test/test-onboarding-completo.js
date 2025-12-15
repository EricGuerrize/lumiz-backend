/**
 * Teste completo do fluxo de onboarding
 * Simula todas as etapas e verifica possíveis problemas
 */

const onboardingFlowService = require('../src/services/onboardingFlowService');
const { normalizePhone } = require('../src/utils/phone');

// Mock de serviços externos para não depender de rede/DB
jest.mock('../src/services/analyticsService', () => ({
    track: jest.fn().mockResolvedValue(true)
}));

jest.mock('../src/services/onboardingService', () => ({
    getWhatsappState: jest.fn().mockResolvedValue(null),
    upsertWhatsappState: jest.fn().mockResolvedValue(true),
    clearWhatsappState: jest.fn().mockResolvedValue(true)
}));

jest.mock('../src/services/geminiService', () => ({
    processMessage: jest.fn().mockRejectedValue(new Error('Mock error'))
}));

describe('Onboarding Flow - Teste Completo', () => {
    const phone = '5511999999999';
    const normalizedPhone = normalizePhone(phone) || phone;

    beforeEach(() => {
        // Limpa estado antes de cada teste
        onboardingFlowService.onboardingStates.clear();
    });

    test('1. Início do onboarding - startIntroFlow', async () => {
        const response = await onboardingFlowService.startIntroFlow(phone);
        
        expect(response).toContain('O que você quer fazer agora');
        expect(response).toContain('1️⃣ Entender como funciona');
        expect(response).toContain('2️⃣ Começar meu cadastro');
        
        // Verifica que estado foi criado
        expect(onboardingFlowService.isOnboarding(phone)).toBe(true);
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('flow0_choice');
    });

    test('2. Escolha "Entender como funciona"', async () => {
        await onboardingFlowService.startIntroFlow(phone);
        const response = await onboardingFlowService.processOnboarding(phone, '1');
        
        expect(response).toContain('Perfeito, vou te mostrar');
        expect(response).toContain('Etapa 1 de 4');
        expect(response).toContain('tipo da sua clínica');
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('reg_step_1_type');
    });

    test('3. Escolha "Começar cadastro"', async () => {
        await onboardingFlowService.startIntroFlow(phone);
        const response = await onboardingFlowService.processOnboarding(phone, '2');
        
        expect(response).toContain('Etapa 1 de 4');
        expect(response).toContain('tipo da sua clínica');
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('reg_step_1_type');
    });

    test('4. Fluxo completo de cadastro', async () => {
        await onboardingFlowService.startIntroFlow(phone);
        
        // Escolhe cadastro
        await onboardingFlowService.processOnboarding(phone, '2');
        
        // Tipo de clínica
        const step1 = await onboardingFlowService.processOnboarding(phone, '1');
        expect(step1).toContain('Etapa 2 de 4');
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('reg_step_2_name');
        
        // Nome da clínica
        const step2 = await onboardingFlowService.processOnboarding(phone, 'Clínica Teste');
        expect(step2).toContain('Etapa 3 de 4');
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('reg_step_3_city');
        
        // Cidade
        const step3 = await onboardingFlowService.processOnboarding(phone, 'São Paulo - SP');
        expect(step3).toContain('Etapa 4 de 4');
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('reg_step_4_owner');
        
        // Responsável + CPF
        const step4 = await onboardingFlowService.processOnboarding(phone, 'Maria Silva 12345678909');
        expect(step4).toContain('email');
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('reg_step_full_email');
        
        // Email
        const step5 = await onboardingFlowService.processOnboarding(phone, 'maria@teste.com');
        expect(step5).toContain('WhatsApp');
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('reg_step_full_whatsapp');
    });

    test('5. Validação de email inválido', async () => {
        await onboardingFlowService.startIntroFlow(phone);
        await onboardingFlowService.processOnboarding(phone, '2');
        await onboardingFlowService.processOnboarding(phone, '1');
        await onboardingFlowService.processOnboarding(phone, 'Clínica Teste');
        await onboardingFlowService.processOnboarding(phone, 'São Paulo - SP');
        await onboardingFlowService.processOnboarding(phone, 'Maria Silva 12345678909');
        
        const response = await onboardingFlowService.processOnboarding(phone, 'email-invalido');
        expect(response).toContain('email parece inválido');
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('reg_step_full_email');
    });

    test('6. Validação de CPF/CNPJ insuficiente', async () => {
        await onboardingFlowService.startIntroFlow(phone);
        await onboardingFlowService.processOnboarding(phone, '2');
        await onboardingFlowService.processOnboarding(phone, '1');
        await onboardingFlowService.processOnboarding(phone, 'Clínica Teste');
        await onboardingFlowService.processOnboarding(phone, 'São Paulo - SP');
        
        const response = await onboardingFlowService.processOnboarding(phone, 'Maria');
        expect(response).toContain('CPF/CNPJ');
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('reg_step_4_owner');
    });

    test('7. Teste gamificado - venda fictícia', async () => {
        await onboardingFlowService.startIntroFlow(phone);
        await onboardingFlowService.processOnboarding(phone, '2');
        await onboardingFlowService.processOnboarding(phone, '1');
        await onboardingFlowService.processOnboarding(phone, 'Clínica Teste');
        await onboardingFlowService.processOnboarding(phone, 'São Paulo - SP');
        await onboardingFlowService.processOnboarding(phone, 'Maria Silva 12345678909');
        await onboardingFlowService.processOnboarding(phone, 'maria@teste.com');
        
        // Mock do createUserFromOnboarding para não falhar
        const userController = require('../src/controllers/userController');
        userController.createUserFromOnboarding = jest.fn().mockResolvedValue({
            user: { id: 'test-user-id' }
        });
        
        await onboardingFlowService.processOnboarding(phone, 'este');
        
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('game_sale_request');
        
        // Envia venda fictícia
        const saleResponse = await onboardingFlowService.processOnboarding(
            phone,
            'Júlia fez um full face com 10ml, pagou R$ 5000, cartão em 6x'
        );
        
        expect(saleResponse).toContain('Entendi assim');
        expect(saleResponse).toContain('Júlia');
        expect(saleResponse).toContain('5000');
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('game_sale_confirm');
    });

    test('8. Confirmação de venda e finalização', async () => {
        // Setup até game_sale_confirm
        await onboardingFlowService.startIntroFlow(phone);
        onboardingFlowService.onboardingStates.set(normalizedPhone, {
            step: 'game_sale_confirm',
            startTime: Date.now(),
            data: {
                telefone: normalizedPhone,
                test_sale: {
                    paciente: 'Júlia',
                    procedimento: 'full face',
                    valor: 5000,
                    forma_pagamento: 'parcelado',
                    parcelas: 6
                }
            }
        });
        
        const response = await onboardingFlowService.processOnboarding(phone, '1');
        
        expect(response).toContain('Pronto! Essa venda já entrou');
        expect(response).toContain('Resumo Financeiro');
        // Verifica que estado foi limpo
        expect(onboardingFlowService.isOnboarding(phone)).toBe(false);
    });

    test('9. Escape hatch - pedir ajuda', async () => {
        await onboardingFlowService.startIntroFlow(phone);
        await onboardingFlowService.processOnboarding(phone, '2');
        
        const response = await onboardingFlowService.processOnboarding(phone, 'preciso de ajuda');
        expect(response).toContain('chamo alguém do time Lumiz');
    });

    test('10. Normalização de telefone', () => {
        const variants = ['11999999999', '+5511999999999', '5511999999999'];
        
        variants.forEach(variant => {
            const normalized = normalizePhone(variant);
            expect(normalized).toBeTruthy();
            expect(onboardingFlowService.isOnboarding(variant)).toBe(false);
        });
    });

    test('11. Resposta inválida no flow0_choice', async () => {
        await onboardingFlowService.startIntroFlow(phone);
        
        const response = await onboardingFlowService.processOnboarding(phone, 'qualquer coisa');
        expect(response).toContain('responde com *1*');
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('flow0_choice');
    });

    test('12. Resposta inválida no tipo de clínica', async () => {
        await onboardingFlowService.startIntroFlow(phone);
        await onboardingFlowService.processOnboarding(phone, '2');
        
        const response = await onboardingFlowService.processOnboarding(phone, 'não sei');
        expect(response).toContain('tipo da sua clínica');
        expect(onboardingFlowService.getOnboardingStep(phone)).toBe('reg_step_1_type');
    });
});
