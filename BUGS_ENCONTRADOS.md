# Bugs e Pontos Críticos Encontrados - Onboarding

## Resumo
Este documento lista os bugs e pontos críticos identificados durante a análise completa do código de onboarding e criação dos testes.

## Bugs Críticos Identificados

### 1. Persistência de Estado Pode Falhar Silenciosamente
**Localização:** `src/services/onboardingFlowService.js:1096-1143`

**Problema:**
- A função `persistState` com debounce pode falhar silenciosamente
- Erros em `upsertWhatsappState` são capturados mas não impedem continuidade do fluxo
- Se a persistência falhar, o estado pode ser perdido ao reiniciar o servidor

**Impacto:** Alto - Usuários podem perder progresso do onboarding

**Recomendação:**
- Adicionar retry com backoff para persistência crítica
- Logar erros de persistência de forma mais visível
- Considerar persistência síncrona para steps críticos (ex: após salvar transação)

### 2. Validação de Criação de Usuário Pode Falhar
**Localização:** `src/services/onboardingFlowService.js:499-521`

**Problema:**
- Se `createUserFromOnboarding` falhar e `findUserByPhone` também falhar, o onboarding continua sem userId
- Isso pode causar falha silenciosa ao tentar salvar transações depois

**Impacto:** Alto - Transações podem não ser salvas

**Recomendação:**
- Abortar onboarding explicitamente se não conseguir criar/encontrar usuário
- Adicionar validação de userId antes de tentar salvar transações

### 3. Validação de Transações Salvas Pode Não Detectar Todas as Falhas
**Localização:** `src/services/onboardingFlowService.js:524-568, 744-786`

**Problema:**
- Verifica apenas `atendimento.id` e `conta.id`
- Se a função retornar objeto diferente do esperado, pode não detectar falha
- Flag `saved` pode não ser setada corretamente em todos os casos

**Impacto:** Médio - Transações podem não ser salvas mas onboarding continua

**Recomendação:**
- Validar estrutura completa do objeto retornado
- Garantir que flag `saved` seja sempre setada quando transação é salva
- Adicionar verificação de erro antes de marcar como salvo

### 4. Timeout de Processamento de Documento Pode Ser Insuficiente
**Localização:** `src/services/onboardingFlowService.js:621-658`

**Problema:**
- Timeout de 30s pode não ser suficiente para documentos grandes
- Se timeout ocorrer, usuário recebe erro mas pode não entender o que fazer

**Impacto:** Médio - Experiência do usuário degradada

**Recomendação:**
- Aumentar timeout para 60s ou tornar configurável
- Melhorar mensagem de erro para guiar usuário
- Oferecer alternativa (digitar valor manualmente) quando documento falha

### 5. Normalização de Telefone Pode Retornar Null
**Localização:** `src/services/onboardingService.js:609, 634, 663`

**Problema:**
- Se `normalizePhone` retornar null, o código pode usar telefone inválido
- Isso pode causar problemas em buscas e persistência

**Impacto:** Médio - Estados podem não ser encontrados corretamente

**Recomendação:**
- Validar telefone antes de usar
- Rejeitar telefones inválidos explicitamente
- Logar quando normalização falha

### 6. Cache Pode Estar Inconsistente com Banco
**Localização:** `src/services/onboardingService.js:124-128, 195-199`

**Problema:**
- Cache pode ter estado antigo enquanto banco tem estado novo
- Invalidação de cache pode falhar silenciosamente

**Impacto:** Médio - Usuários podem ver estado desatualizado

**Recomendação:**
- Implementar TTL mais curto para dados críticos
- Adicionar verificação de timestamp ao buscar do cache
- Garantir invalidação de cache em todas as atualizações

## Pontos de Atenção (Não são bugs, mas podem causar problemas)

### 1. Race Conditions em Persistência
**Localização:** `src/services/onboardingFlowService.js:1096-1143`

**Problema:**
- Múltiplas atualizações rápidas podem causar persistências concorrentes
- Última persistência pode sobrescrever estado mais recente

**Recomendação:**
- Implementar lock ou queue para persistências
- Usar timestamps para detectar conflitos

### 2. Limpeza Automática de Estados Pode Interferir
**Localização:** `src/services/onboardingFlowService.js:918-936`

**Problema:**
- Limpeza automática pode remover estados ativos se `startTime` não for atualizado
- Estados podem ser limpos durante processo ativo

**Recomendação:**
- Verificar se estado está ativo antes de limpar
- Atualizar `startTime` em cada interação
- Adicionar flag `isActive` para estados em uso

### 3. Mensagens de Erro Podem Ser Mais Claras
**Localização:** Vários arquivos

**Problema:**
- Algumas mensagens de erro são genéricas
- Usuário pode não saber o que fazer após erro

**Recomendação:**
- Melhorar mensagens de erro para serem mais acionáveis
- Adicionar instruções claras sobre próximos passos
- Oferecer alternativas quando possível

## Testes Criados

Foram criados os seguintes arquivos de teste para cobrir os pontos críticos:

1. **tests/integration/onboardingFailurePoints.test.js** - Testa pontos de falha críticos
2. **tests/unit/onboardingEdgeCases.test.js** - Testa edge cases e validações
3. **tests/integration/onboardingExternalServices.test.js** - Testa integrações externas
4. **tests/performance/onboardingConcurrency.test.js** - Testa concorrência
5. **tests/resilience/onboardingRecovery.test.js** - Testa recuperação de erros
6. **tests/e2e/onboardingE2E.test.js** - Expandido com testes de persistência e múltiplos custos

## Próximos Passos

1. Executar todos os testes e corrigir falhas encontradas
2. Implementar correções para os bugs críticos identificados
3. Adicionar monitoramento para detectar falhas de persistência
4. Melhorar logging para facilitar debug
5. Adicionar métricas para acompanhar taxa de sucesso do onboarding

## Notas

- Alguns testes podem falhar devido a dependências externas (Redis, Supabase) não configuradas no ambiente de teste
- Mocks foram criados para serviços externos, mas alguns podem precisar de ajustes
- Testes de performance podem precisar de ambiente dedicado

