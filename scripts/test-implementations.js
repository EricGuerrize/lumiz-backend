#!/usr/bin/env node
/**
 * Script para testar as implementações e encontrar erros/inconsistências
 */
require('dotenv').config();

const errors = [];
const warnings = [];

console.log('🔍 Testando implementações...\n');

// Test 1: Validators
console.log('1. Testando validators...');
try {
  const onboardingValidators = require('../src/validators/onboarding.validators');
  const userValidators = require('../src/validators/user.validators');
  const dashboardValidators = require('../src/validators/dashboard.validators');
  
  // Test schema structure
  if (!onboardingValidators.updateStateSchema) {
    errors.push('❌ updateStateSchema não exportado');
  }
  if (!onboardingValidators.recordStepSchema) {
    errors.push('❌ recordStepSchema não exportado');
  }
  
  // Test schema validation
  try {
    onboardingValidators.recordStepSchema.parse({ body: { stepId: 'test' } });
    console.log('   ✅ recordStepSchema válido');
  } catch (e) {
    errors.push(`❌ recordStepSchema inválido: ${e.message}`);
  }
  
  try {
    onboardingValidators.recordStepSchema.parse({ body: {} });
    errors.push('❌ recordStepSchema deveria falhar sem stepId');
  } catch (e) {
    console.log('   ✅ recordStepSchema valida corretamente (falha quando esperado)');
  }
  
} catch (e) {
  errors.push(`❌ Erro ao carregar validators: ${e.message}`);
}

// Test 2: Validation Middleware
console.log('\n2. Testando validation middleware...');
try {
  const { validate } = require('../src/middleware/validationMiddleware');
  const { recordStepSchema } = require('../src/validators/onboarding.validators');
  
  if (typeof validate !== 'function') {
    errors.push('❌ validate não é uma função');
  } else {
    console.log('   ✅ validate é uma função');
  }
  
  // Test schema shape access
  if (!recordStepSchema.shape) {
    warnings.push('⚠️  recordStepSchema não tem .shape (pode ser problema)');
  } else {
    console.log('   ✅ Schema tem .shape');
  }
  
} catch (e) {
  errors.push(`❌ Erro ao carregar validation middleware: ${e.message}`);
}

// Test 3: Error Handler
console.log('\n3. Testando error handler...');
try {
  const errorHandler = require('../src/middleware/errorHandler');
  
  if (typeof errorHandler !== 'function') {
    errors.push('❌ errorHandler não é uma função');
  } else {
    console.log('   ✅ errorHandler é uma função');
  }
  
} catch (e) {
  errors.push(`❌ Erro ao carregar error handler: ${e.message}`);
}

// Test 4: Error Classes
console.log('\n4. Testando error classes...');
try {
  const { AppError, BadRequestError, ValidationError } = require('../src/errors/errors');
  
  if (!AppError) {
    errors.push('❌ AppError não exportado');
  }
  
  // Test error instantiation
  const testError = new BadRequestError('Test');
  if (testError.statusCode !== 400) {
    errors.push(`❌ BadRequestError statusCode incorreto: ${testError.statusCode}`);
  } else {
    console.log('   ✅ BadRequestError funciona corretamente');
  }
  
  const valError = new ValidationError('Test', [{ field: 'test', message: 'error' }]);
  if (!valError.errors || valError.errors.length === 0) {
    errors.push('❌ ValidationError não armazena errors');
  } else {
    console.log('   ✅ ValidationError funciona corretamente');
  }
  
} catch (e) {
  errors.push(`❌ Erro ao carregar error classes: ${e.message}`);
}

// Test 5: Cache Service
console.log('\n5. Testando cache service...');
try {
  const cacheService = require('../src/services/cacheService');
  
  if (!cacheService.get || typeof cacheService.get !== 'function') {
    errors.push('❌ cacheService.get não é uma função');
  }
  if (!cacheService.set || typeof cacheService.set !== 'function') {
    errors.push('❌ cacheService.set não é uma função');
  }
  if (!cacheService.invalidatePhone || typeof cacheService.invalidatePhone !== 'function') {
    errors.push('❌ cacheService.invalidatePhone não é uma função');
  } else {
    console.log('   ✅ cacheService tem métodos necessários');
  }
  
  // Test cache methods (sem Redis, deve retornar null/false graciosamente)
  cacheService.get('test').then(result => {
    if (result !== null && cacheService.enabled) {
      // OK se Redis estiver configurado
    }
  }).catch(e => {
    warnings.push(`⚠️  cacheService.get falhou: ${e.message}`);
  });
  
} catch (e) {
  errors.push(`❌ Erro ao carregar cache service: ${e.message}`);
}

// Test 6: Onboarding Service Cache Integration
console.log('\n6. Testando integração de cache no onboardingService...');
try {
  const onboardingService = require('../src/services/onboardingService');
  
  // Verificar se ensureState usa cache
  const ensureStateCode = onboardingService.ensureState.toString();
  if (!ensureStateCode.includes('cacheService.get')) {
    warnings.push('⚠️  ensureState pode não estar usando cache');
  } else {
    console.log('   ✅ ensureState usa cache');
  }
  
  if (!ensureStateCode.includes('cacheService.set')) {
    warnings.push('⚠️  ensureState pode não estar salvando no cache');
  } else {
    console.log('   ✅ ensureState salva no cache');
  }
  
  // Verificar se métodos de update invalidam cache
  const updateStepStatusCode = onboardingService.updateStepStatus.toString();
  if (!updateStepStatusCode.includes('invalidate')) {
    warnings.push('⚠️  updateStepStatus pode não estar invalidando cache');
  } else {
    console.log('   ✅ updateStepStatus invalida cache');
  }
  
} catch (e) {
  errors.push(`❌ Erro ao verificar onboardingService: ${e.message}`);
}

// Test 7: Routes Integration
console.log('\n7. Testando integração nas rotas...');
try {
  const onboardingRoutes = require('../src/routes/onboarding.routes');
  const userRoutes = require('../src/routes/user.routes');
  
  // Verificar se rotas usam validate
  const routesCode = onboardingRoutes.toString();
  if (!routesCode.includes('validate')) {
    warnings.push('⚠️  Rotas de onboarding podem não estar usando validação');
  } else {
    console.log('   ✅ Rotas de onboarding usam validação');
  }
  
} catch (e) {
  errors.push(`❌ Erro ao verificar rotas: ${e.message}`);
}

// Test 8: Server Error Handler
console.log('\n8. Testando integração do error handler no server...');
try {
  const fs = require('fs');
  const serverCode = fs.readFileSync('./src/server.js', 'utf8');
  
  if (!serverCode.includes('errorHandler')) {
    errors.push('❌ server.js não está usando errorHandler');
  } else {
    console.log('   ✅ server.js usa errorHandler');
  }
  
  // Verificar se está no final (deve ser último middleware)
  const errorHandlerIndex = serverCode.indexOf('errorHandler');
  const appListenIndex = serverCode.indexOf('app.listen');
  
  if (errorHandlerIndex > appListenIndex && appListenIndex !== -1) {
    warnings.push('⚠️  errorHandler pode não estar no final (deve ser último middleware)');
  } else {
    console.log('   ✅ errorHandler está posicionado corretamente');
  }
  
} catch (e) {
  errors.push(`❌ Erro ao verificar server.js: ${e.message}`);
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('📊 RESUMO DOS TESTES\n');

if (errors.length === 0 && warnings.length === 0) {
  console.log('✅ Nenhum erro ou warning encontrado!');
  process.exit(0);
}

if (errors.length > 0) {
  console.log(`❌ ERROS ENCONTRADOS (${errors.length}):`);
  errors.forEach(e => console.log(`   ${e}`));
}

if (warnings.length > 0) {
  console.log(`\n⚠️  WARNINGS (${warnings.length}):`);
  warnings.forEach(w => console.log(`   ${w}`));
}

console.log('\n' + '='.repeat(50));

process.exit(errors.length > 0 ? 1 : 0);

