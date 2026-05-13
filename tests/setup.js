// Garante que feature flags experimentais não afetam os testes unitários
process.env.ONBOARDING_V2 = 'false';
