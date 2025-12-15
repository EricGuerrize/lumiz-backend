# Análise Completa do Onboarding - Problemas e Melhorias

## 🐛 Problemas Identificados

### 1. **BUG CRÍTICO: Chamada recursiva com telefone não normalizado**
**Localização**: `src/services/onboardingFlowService.js:486`
```javascript
case 'game_sale_request': {
    onboarding.step = 'game_sale_review';
    await persistState();
    return await this.processOnboarding(phone, messageTrimmed); // ❌ 'phone' não está normalizado aqui
}
```
**Problema**: O `phone` usado na recursão não está normalizado, pode causar inconsistência de estado.

**Solução**: Usar `normalizedPhone`:
```javascript
return await this.processOnboarding(normalizedPhone, messageTrimmed);
```

### 2. **Possível loop infinito em `game_sale_request`**
**Problema**: Se o usuário enviar uma mensagem inválida no estado `game_sale_request`, pode entrar em loop.

**Solução**: Adicionar validação antes de mudar para `game_sale_review` ou tratar mensagens vazias/inválidas.

### 3. **Falta normalização de telefone nos métodos de persistência**
**Localização**: `src/services/onboardingService.js:529, 550, 576`
**Problema**: `getWhatsappState`, `upsertWhatsappState`, `clearWhatsappState` não normalizam o telefone antes de buscar.

**Solução**: Normalizar telefone no início de cada método.

### 4. **Estado pode ficar "preso" se persistência falhar silenciosamente**
**Problema**: Se `upsertWhatsappState` falhar, o estado em memória continua, mas não persiste. Em restart, perde o progresso.

**Solução**: Adicionar retry logic ou alerta quando persistência falha múltiplas vezes.

### 5. **Falta timeout para estados antigos**
**Problema**: Se um usuário ficar dias sem responder, o estado continua válido indefinidamente.

**Solução**: Adicionar `expiresAt` e limpar estados com mais de X dias.

### 6. **Validação de WhatsApp muito permissiva**
**Localização**: `src/services/onboardingFlowService.js:453-461`
**Problema**: Aceita qualquer string com 10+ dígitos, pode aceitar números inválidos.

**Solução**: Validar formato brasileiro (DDD + número) ou usar `isValidPhone()` do utils.

## 💡 Melhorias Sugeridas

### 1. **Adicionar timeout de inatividade**
```javascript
// No constructor
this.STATE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

// No processOnboarding, antes de processar
if (Date.now() - onboarding.startTime > this.STATE_TIMEOUT_MS) {
    this.onboardingStates.delete(normalizedPhone);
    await onboardingService.clearWhatsappState(normalizedPhone);
    return onboardingCopy.stateExpiredMessage(); // Criar essa mensagem
}
```

### 2. **Melhorar tratamento de erros com mensagens mais amigáveis**
```javascript
// Em vez de apenas logar erro, retornar mensagem útil
catch (e) {
    console.error('[ONBOARDING] Erro:', e);
    return onboardingCopy.errorMessage({ 
        step: onboarding.step,
        canRetry: true 
    });
}
```

### 3. **Adicionar validação de progresso**
```javascript
// Verificar se usuário está "pulando" etapas
const validateStepTransition = (from, to) => {
    const validTransitions = {
        'flow0_choice': ['reg_step_1_type'],
        'reg_step_1_type': ['reg_step_2_name'],
        // ...
    };
    return validTransitions[from]?.includes(to) ?? false;
};
```

### 4. **Adicionar analytics de dropoff**
```javascript
// Trackar quando usuário para em cada etapa
await analyticsService.track('onboarding_step_dropoff', {
    phone: normalizedPhone,
    step: onboarding.step,
    timeSpent: Date.now() - onboarding.startTime
});
```

### 5. **Melhorar extração de nome e documento**
**Problema**: `extractNameAndDoc` pode falhar com formatos como "123.456.789-09 Maria Silva".

**Solução**: Tentar múltiplos padrões:
```javascript
// Padrão 1: Nome primeiro
// Padrão 2: CPF primeiro
// Padrão 3: Apenas números no final
```

### 6. **Adicionar retry para persistência**
```javascript
const persistStateWithRetry = async (maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            await onboardingService.upsertWhatsappState(...);
            return;
        } catch (e) {
            if (i === maxRetries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
};
```

### 7. **Normalizar telefone nos métodos de persistência**
```javascript
async getWhatsappState(phone) {
    const normalizedPhone = normalizePhone(phone) || phone;
    // ... resto do código
}
```

### 8. **Adicionar validação de formato de cidade/UF**
```javascript
case 'reg_step_3_city':
    const cityMatch = messageTrimmed.match(/(.+?)\s*[-–]\s*([A-Z]{2})/i);
    if (!cityMatch) {
        return await respond(
            'Formato inválido. Use: *Cidade - UF*\n' +
            'Exemplo: *São Paulo - SP*'
        );
    }
    // ...
```

### 9. **Melhorar mensagem de erro quando não identifica valor**
**Problema**: Mensagem genérica não ajuda muito.

**Solução**: Mostrar exemplo mais específico baseado no que foi detectado:
```javascript
if (!valor) {
    const detected = {
        hasNumbers: /\d/.test(messageTrimmed),
        hasCurrency: /r\$/i.test(messageTrimmed),
        hasClient: /^[A-Za-z]/.test(messageTrimmed)
    };
    return onboardingCopy.fakeSaleErrorHelp(detected);
}
```

### 10. **Adicionar comando "voltar" ou "reiniciar"**
```javascript
// No início do processOnboarding
if (messageLower.includes('voltar') || messageLower.includes('reiniciar')) {
    this.onboardingStates.delete(normalizedPhone);
    await onboardingService.clearWhatsappState(normalizedPhone);
    return await this.startIntroFlow(normalizedPhone);
}
```

## 📊 Métricas Recomendadas

1. **Taxa de conclusão por etapa**
2. **Tempo médio por etapa**
3. **Taxa de dropoff por etapa**
4. **Taxa de retomada após restart**
5. **Taxa de erro por tipo de validação**

## 🔧 Correções Imediatas (P0)

1. ✅ Corrigir chamada recursiva com telefone normalizado
2. ✅ Normalizar telefone nos métodos de persistência
3. ✅ Adicionar validação de WhatsApp mais robusta
4. ✅ Adicionar timeout para estados antigos

## 🎯 Melhorias Futuras (P1)

1. Retry logic para persistência
2. Analytics de dropoff
3. Comando "voltar/reiniciar"
4. Validação de formato de cidade/UF
5. Mensagens de erro mais específicas
