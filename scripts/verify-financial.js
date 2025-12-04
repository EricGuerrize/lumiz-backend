const transactionController = require('../src/controllers/transactionController');
const userController = require('../src/controllers/userController');
const supabase = require('../src/db/supabase');
const crypto = require('crypto');

async function testFinancialLogic() {
    const testPhone = '551199999' + crypto.randomInt(1000, 9999); // Random phone
    let userId = null;

    try {
        console.log('=== INICIANDO TESTE FINANCEIRO ===');
        console.log(`1. Criando usuário de teste (${testPhone})...`);

        // Mock onboarding data
        const onboardingData = {
            nome_completo: 'Test User',
            nome_clinica: 'Test Clinic',
            telefone: testPhone,
            email: `test${Date.now()}@example.com`
        };

        // Create user directly via Supabase to avoid full onboarding complexity if possible, 
        // but userController.createUserFromOnboarding is what we want to test implicitly or just use for setup.
        // Let's use a simpler approach: create profile directly if userController is too complex, 
        // but userController.createUserFromOnboarding handles Auth user creation too.
        // Let's try to find an existing user or just create a dummy profile row if Auth is not strictly required for FKs (usually it is).
        // Actually, let's just use the userController to be realistic.

        // Note: createUserFromOnboarding might fail if Supabase Auth requires email confirmation or unique constraints.
        // Let's assume we can just insert into 'profiles' if we generate a random UUID, assuming 'profiles.id' is not strictly FK to auth.users 
        // (it usually is, but for testing maybe we can get away with it or use a real auth creation).
        // Checking userController... it uses supabase.auth.admin.createUser.

        const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
            email: onboardingData.email,
            password: 'password123',
            email_confirm: true,
            user_metadata: { nome_completo: onboardingData.nome_completo }
        });

        if (authError) throw new Error(`Auth create failed: ${authError.message}`);
        userId = authUser.user.id;

        // Create profile
        await supabase.from('profiles').insert([{
            id: userId,
            nome_completo: onboardingData.nome_completo,
            nome_clinica: onboardingData.nome_clinica,
            telefone: testPhone,
            is_active: true
        }]);

        console.log(`✅ Usuário criado: ${userId}`);

        // TESTE 1: Venda Parcelada
        console.log('\n2. Testando Venda Parcelada (3x)...');
        const venda = await transactionController.createTransaction(userId, {
            tipo: 'entrada',
            valor: 3000,
            categoria: 'Botox',
            descricao: 'Botox Teste',
            data: new Date().toISOString(),
            forma_pagamento: 'parcelado',
            parcelas: 3
        });
        console.log(`✅ Venda criada: ${venda.id}`);

        // Verificar parcelas
        const { data: parcelasVenda, error: erroParcelas } = await supabase
            .from('parcelas')
            .select('*')
            .eq('atendimento_id', venda.id);

        if (erroParcelas) throw erroParcelas;

        console.log(`📊 Parcelas encontradas: ${parcelasVenda.length}`);
        if (parcelasVenda.length !== 3) throw new Error('Deveria ter criado 3 parcelas');
        console.log('✅ Parcelas de venda OK');

        // TESTE 2: Custo Parcelado
        console.log('\n3. Testando Custo Parcelado (5x)...');
        const custo = await transactionController.createTransaction(userId, {
            tipo: 'saida',
            valor: 5000,
            categoria: 'Equipamento',
            descricao: 'Laser Teste',
            data: new Date().toISOString(),
            forma_pagamento: 'parcelado',
            parcelas: 5
        });
        // createContaPagar returns the first installment or the account object
        console.log(`✅ Custo criado (primeira parcela ID): ${custo.id}`);

        // Verificar se criou 5 contas a pagar
        // A descrição deve conter "(X/5)" ou similar, ou podemos buscar por valor/data/user
        // O controller cria 5 registros independentes.
        const { data: contasCriadas, error: erroContas } = await supabase
            .from('contas_pagar')
            .select('*')
            .eq('user_id', userId)
            .like('descricao', '%Laser Teste%');

        console.log(`📊 Contas encontradas: ${contasCriadas.length}`);
        if (contasCriadas.length !== 5) throw new Error('Deveria ter criado 5 contas a pagar');
        console.log('✅ Parcelas de custo OK');

        // TESTE 3: Delete Cascata (Venda)
        console.log('\n4. Testando Delete Cascata (Venda)...');
        await transactionController.deleteTransaction(userId, venda.id);

        // Verificar se atendimento sumiu
        const { data: checkVenda } = await supabase.from('atendimentos').select('*').eq('id', venda.id).single();
        if (checkVenda) throw new Error('Venda não foi deletada');

        // Verificar se parcelas sumiram
        const { data: checkParcelas } = await supabase.from('parcelas').select('*').eq('atendimento_id', venda.id);
        if (checkParcelas.length > 0) throw new Error('Parcelas da venda não foram deletadas');

        console.log('✅ Delete cascata OK');

        console.log('\n=== TODOS OS TESTES PASSARAM ===');

    } catch (error) {
        console.error('\n❌ ERRO NO TESTE:', error.message);
        console.error(error);
    } finally {
        // Cleanup
        if (userId) {
            console.log('\nLimpeza: Removendo usuário de teste...');
            await supabase.auth.admin.deleteUser(userId);
            // Profile cascade delete usually handles the rest, or we might leave trash if no cascade.
            // Explicitly delete profile just in case
            await supabase.from('profiles').delete().eq('id', userId);
        }
    }
}

testFinancialLogic();
