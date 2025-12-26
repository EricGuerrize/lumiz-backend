# Checklist Pré-Produção - Onboarding

## ✅ Status Atual

### Testes Criados
- ✅ Testes de pontos de falha críticos
- ✅ Testes de edge cases
- ✅ Testes de integrações externas
- ✅ Testes de concorrência
- ✅ Testes de recuperação
- ✅ Testes E2E expandidos

### Bugs Identificados
- ✅ Documentados em `BUGS_ENCONTRADOS.md`

## ⚠️ Ações Críticas ANTES de Liberar

### 🔴 CRÍTICO - Deve ser feito ANTES de produção

1. **Remover Logs de Debug**
   - **Arquivo:** `src/services/onboardingFlowService.js`
   - **Problema:** Múltiplas chamadas `fetch('http://127.0.0.1:7242/...')` espalhadas pelo código
   - **Ação:** Remover ou comentar todas as linhas com `#region agent log` e `fetch('http://127.0.0.1:7242/...')`
   - **Impacto:** Alto - Pode causar erros e poluir logs

2. **Melhorar Tratamento de Persistência Crítica**
   - **Arquivo:** `src/services/onboardingFlowService.js:1096-1143`
   - **Ação:** Adicionar retry com backoff para persistências críticas (após salvar transações)
   - **Impacto:** Alto - Usuários podem perder progresso

3. **Validar Telefone Antes de Usar**
   - **Arquivo:** `src/services/onboardingService.js:609, 634, 663`
   - **Ação:** Adicionar validação explícita quando `normalizePhone` retorna null
   - **Impacto:** Médio - Pode causar problemas de busca

### 🟡 IMPORTANTE - Recomendado fazer antes

4. **Aumentar Timeout de Processamento de Documento**
   - **Arquivo:** `src/services/onboardingFlowService.js:625`
   - **Ação:** Aumentar de 30s para 60s ou tornar configurável
   - **Impacto:** Médio - Melhora experiência do usuário

5. **Melhorar Mensagens de Erro**
   - **Arquivo:** `src/copy/onboardingWhatsappCopy.js`
   - **Ação:** Revisar mensagens de erro para serem mais acionáveis
   - **Impacto:** Médio - Melhora experiência do usuário

6. **Adicionar Monitoramento de Falhas de Persistência**
   - **Ação:** Adicionar métricas/alerts quando persistência falha
   - **Impacto:** Médio - Facilita detecção de problemas

### 🟢 OPCIONAL - Pode ser feito depois

7. **Implementar Lock para Persistências Concorrentes**
   - **Impacto:** Baixo - Melhora consistência

8. **Adicionar Flag `isActive` para Estados**
   - **Impacto:** Baixo - Previne limpeza acidental

9. **Melhorar Invalidação de Cache**
   - **Impacto:** Baixo - Melhora consistência

## 📋 Checklist Rápido

Antes de fazer deploy para produção, verifique:

- [ ] Remover todos os logs de debug (`fetch('http://127.0.0.1:7242/...')`)
- [ ] Testar fluxo completo de onboarding em ambiente de staging
- [ ] Verificar que persistência funciona corretamente
- [ ] Testar com múltiplos usuários simultâneos
- [ ] Verificar logs para erros silenciosos
- [ ] Configurar alertas para falhas críticas
- [ ] Revisar mensagens de erro com usuários reais
- [ ] Documentar procedimento de rollback

## 🚀 Pode Liberar?

### ✅ SIM, se:
- Itens críticos (1-3) foram corrigidos
- Testes passaram em ambiente de staging
- Monitoramento está configurado

### ❌ NÃO, se:
- Logs de debug ainda estão no código
- Persistência não tem retry
- Não há monitoramento de erros

## 📝 Notas

- Os bugs identificados são principalmente relacionados a resiliência e experiência do usuário
- O código atual já tem tratamento de erros básico, mas pode ser melhorado
- Testes criados cobrem os principais cenários de falha
- Recomenda-se fazer deploy gradual (canary) para monitorar

