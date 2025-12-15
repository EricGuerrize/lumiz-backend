# Melhorias Implementadas no Onboarding

## ✅ Implementações Concluídas

### 1. **Separação de Copy (Mensagens)**
- **Arquivo**: `src/copy/onboardingWhatsappCopy.js`
- **Benefício**: Todas as mensagens do onboarding estão centralizadas, facilitando iterações de UX sem mexer em lógica
- **Funções**: `introGreeting()`, `entryMenu()`, `clinicTypeQuestion()`, `fakeSaleReview()`, etc.

### 2. **Serviço de Analytics/Telemetria**
- **Arquivo**: `src/services/analyticsService.js`
- **Benefício**: Tracking de eventos para análise de funil e comportamento
- **Eventos rastreados**:
  - `onboarding_whatsapp_started`
  - `onboarding_whatsapp_resumed`
  - `onboarding_whatsapp_completed`
  - `transaction_confirmation_accepted`
  - `transaction_confirmation_cancelled`
- **Tabela**: `analytics_events` (migration criada em `supabase/migrations/20251213_create_analytics_events.sql`)

### 3. **Normalização de Telefone**
- **Arquivo**: `src/utils/phone.js`
- **Benefício**: Garante formato consistente (E.164) em todo o sistema, evitando bugs de "não achei usuário"
- **Funções**: `normalizePhone()`, `formatPhone()`, `isValidPhone()`, `getLocalNumber()`

### 4. **Persistência do Estado do Onboarding**
- **Arquivo**: `src/services/onboardingService.js` (métodos adicionados)
- **Benefício**: Estado do onboarding WhatsApp agora persiste no Supabase, sobrevivendo a restarts do servidor
- **Métodos**:
  - `getWhatsappState(phone)` - Retoma estado persistido
  - `upsertWhatsappState(phone, { step, data })` - Salva estado
  - `clearWhatsappState(phone)` - Limpa estado ao completar

### 5. **Integração Completa**
- **Arquivos ajustados**:
  - `src/services/onboardingFlowService.js` - Usa copy, analytics, persistência e normalização
  - `src/controllers/messageController.js` - Normaliza telefone e tracka eventos

## 📊 Estrutura de Dados

### Estado Persistido (onboarding_progress.data.realtime.whatsapp)
```json
{
  "step": "reg_step_2_name",
  "startTime": "2025-12-13T10:00:00Z",
  "data": {
    "telefone": "+5511999999999",
    "tipo_clinica": "Estética",
    "nome_clinica": "Clínica X",
    "userId": "uuid-do-usuario"
  },
  "updated_at": "2025-12-13T10:05:00Z"
}
```

### Eventos de Analytics
```json
{
  "event_name": "onboarding_whatsapp_started",
  "phone": "+5511999999999",
  "user_id": null,
  "source": "whatsapp",
  "properties": {},
  "created_at": "2025-12-13T10:00:00Z"
}
```

## 🔄 Fluxo de Persistência

1. **Início**: `startIntroFlow()` tenta retomar estado persistido
2. **Durante**: Cada resposta do usuário persiste estado via `respond()`
3. **Fim**: `respondAndClear()` limpa estado e tracka conclusão

## 🎯 Próximos Passos Sugeridos

1. **Testes automatizados** - Criar testes de "transcript" para garantir que mudanças não quebrem a máquina de estados
2. **Dashboard de analytics** - Visualizar funil de onboarding e identificar dropoffs
3. **A/B testing** - Usar `ab_variant` já existente no `onboarding_progress` para testar variações de copy
4. **Retry logic** - Implementar retry automático para falhas de persistência (atualmente só loga)

## 📝 Notas Técnicas

- **Falhas silenciosas**: Analytics e persistência não quebram o fluxo principal (try/catch com logs)
- **Normalização**: Telefone é normalizado em todos os pontos de entrada
- **Compatibilidade**: Código mantém compatibilidade com estados antigos (fallback para telefone não normalizado)
