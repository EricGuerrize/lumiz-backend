# 🔴 PLANO DE CORREÇÃO - VULNERABILIDADES CRÍTICAS

**Projeto**: Lumiz Backend
**Data**: 2026-01-13
**Status**: 🔴 NÃO PRONTO PARA PRODUÇÃO
**Prazo Estimado**: 2-3 semanas (com dedicação full-time)

---

## 📋 RESUMO EXECUTIVO

Este documento detalha o plano de ação para corrigir **6 vulnerabilidades críticas** identificadas no backend do Lumiz. Estas vulnerabilidades BLOQUEIAM a liberação do sistema para usuários reais.

**Vulnerabilidades Críticas:**
1. 🔴 Debug logging vazando dados (31 instâncias)
2. 🔴 Credenciais expostas em arquivo .env
3. 🔴 RLS (Row Level Security) não configurado
4. 🔴 Autenticação fraca (fallback telefone)
5. 🔴 Webhook sem validação de assinatura
6. 🔴 Uploads sem validação

**Risco se não corrigir**: Vazamento de dados financeiros, acesso não autorizado, violação LGPD, responsabilidade legal.

---

## 🎯 PRIORIZAÇÃO

```
BLOCO 1 (Urgente - Dia 1-3): #1, #2
  ↳ Remove vazamentos ativos + protege credenciais

BLOCO 2 (Crítico - Dia 4-7): #3, #4
  ↳ Isola dados entre usuários + fortalece auth

BLOCO 3 (Importante - Dia 8-10): #5, #6
  ↳ Protege endpoints públicos

BLOCO 4 (Validação - Dia 11-15): Testes + documentação
```

---

## 🔴 VULNERABILIDADE #1: Debug Logging Vazando Dados

### Descrição do Problema
```javascript
// Encontrado em 31 locais do código
fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    location: 'messageController.js:60',
    message: 'Calling processOnboarding',
    data: { phone: normalizedPhone, message }, // 🔴 DADOS SENSÍVEIS!
    timestamp: Date.now()
  })
}).catch(() => {});
```

**Impacto**:
- Dados sensíveis (telefone, mensagens, transações) sendo enviados para endpoint externo
- Em produção, vai tentar conectar a localhost e falhar (gastando recursos)
- Pode ser usado para rastrear comportamento de usuários

**Arquivos Afetados** (31 instâncias):
- `src/controllers/messageController.js` (2x)
- `src/controllers/messageController.refactored.js` (2x)
- `src/services/onboardingFlowService.js` (2x)
- `src/controllers/messages/documentHandler.js` (3x)
- `src/controllers/messages/editHandler.js` (3x)
- `src/controllers/messages/exportHandler.js` (3x)
- `src/controllers/messages/goalHandler.js` (3x)
- `src/controllers/messages/helpHandler.js` (2x)
- `src/controllers/messages/insightsHandler.js` (3x)
- `src/controllers/messages/installmentHandler.js` (2x)
- `src/controllers/messages/queryHandler.js` (2x)
- `src/controllers/messages/scheduleHandler.js` (2x)
- `src/controllers/messages/searchHandler.js` (2x)
- `src/controllers/messages/transactionHandler.js` (2x)

### Plano de Correção

#### PASSO 1: Criar script de remoção automatizada
```bash
# Script: scripts/remove-debug-fetch.sh
#!/bin/bash

echo "🔍 Procurando instâncias de debug fetch..."

# Encontrar todos os arquivos com fetch para localhost:7242
FILES=$(grep -r "fetch('http://127.0.0.1:7242" src/ -l)

echo "📝 Arquivos encontrados:"
echo "$FILES"

# Contar instâncias
COUNT=$(grep -r "fetch('http://127.0.0.1:7242" src/ | wc -l)
echo "📊 Total de instâncias: $COUNT"

# Backup
echo "💾 Criando backup..."
mkdir -p .backup/$(date +%Y%m%d_%H%M%S)
for file in $FILES; do
  cp "$file" ".backup/$(date +%Y%m%d_%H%M%S)/"
done

echo "✅ Backup criado em .backup/"
echo ""
echo "⚠️  Execute o script de remoção manualmente ou revise cada arquivo"
```

#### PASSO 2: Padrões de remoção

**Padrão 1**: Fetch completo (mais comum)
```javascript
// 🔴 REMOVER:
fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    location: 'messageController.js:60',
    message: 'Calling processOnboarding',
    data: { phone: normalizedPhone, message },
    timestamp: Date.now(),
    sessionId: 'debug-session',
    runId: 'run1',
    hypothesisId: 'A'
  })
}).catch(() => {});

// ✅ SUBSTITUIR POR: (nada - remover completamente)
```

**Padrão 2**: Fetch com variáveis
```javascript
// 🔴 REMOVER:
const debugData = {
  location: 'file.js:123',
  data: someData
};
fetch('http://127.0.0.1:7242/ingest/...', {
  body: JSON.stringify(debugData)
}).catch(() => {});

// ✅ SUBSTITUIR POR: (nada)
```

**Padrão 3**: Se precisar debug em desenvolvimento
```javascript
// ✅ ALTERNATIVA (se realmente precisar):
if (process.env.NODE_ENV === 'development' && process.env.DEBUG_ENDPOINT) {
  logger.debug('Debug info', {
    location: 'messageController.js:60',
    data: { phone: '***REDACTED***', messageLength: message.length }
  });
}
```

#### PASSO 3: Script de remoção automatizado

```bash
# Script: scripts/fix-debug-fetch.js
const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Regex para encontrar fetch debug
const DEBUG_FETCH_REGEX = /fetch\(['"]http:\/\/127\.0\.0\.1:7242[^)]+\)\s*\.catch\([^)]*\)\s*;?/gs;

// Encontrar todos os arquivos
const files = glob.sync('src/**/*.js');

let totalRemoved = 0;

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const matches = content.match(DEBUG_FETCH_REGEX);

  if (matches) {
    console.log(`📝 Processando: ${file} (${matches.length} instâncias)`);

    // Remover fetches
    const newContent = content.replace(DEBUG_FETCH_REGEX, '');

    // Salvar
    fs.writeFileSync(file, newContent, 'utf8');

    totalRemoved += matches.length;
    console.log(`   ✅ Removidas ${matches.length} instâncias`);
  }
});

console.log(`\n✅ Total removido: ${totalRemoved} instâncias`);
```

#### PASSO 4: Validação

```bash
# 1. Executar remoção
node scripts/fix-debug-fetch.js

# 2. Verificar que não restaram instâncias
grep -r "fetch('http://127.0.0.1:7242" src/
# Deve retornar: (nada)

# 3. Verificar que código ainda compila
npm run lint
npm test

# 4. Verificar git diff
git diff src/ | grep -A 5 -B 5 "fetch"
```

#### PASSO 5: Prevenção futura

```javascript
// .eslintrc.js - adicionar regra
module.exports = {
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.name='fetch'] Literal[value=/127\\.0\\.0\\.1/]",
        message: '🔴 Não use fetch para localhost em código de produção. Use logger.debug()'
      }
    ]
  }
};
```

### Checklist de Validação

- [ ] Backup dos arquivos criado
- [ ] Script de remoção executado
- [ ] Verificado que 0 instâncias restam (`grep -r "127.0.0.1:7242"`)
- [ ] Código compila sem erros (`npm run build`)
- [ ] Testes passam (`npm test`)
- [ ] ESLint regra adicionada para prevenir
- [ ] Commit das mudanças
- [ ] Deploy em staging e verificar logs

**Tempo Estimado**: 2-4 horas

---

## 🔴 VULNERABILIDADE #2: Credenciais Expostas em .env

### Descrição do Problema

```bash
# .env (NUNCA deve ser versionado!)
EVOLUTION_API_KEY=4C7B62D0F0CD-4D1A-82E0-31F68E056A60
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
GEMINI_API_KEY=AIzaSyCt0-6YOs7V8p_o7JcdYtxc75-5T9UbMTk
GOOGLE_VISION_API_KEY=AIzaSyDgoqVaiYdQPxlpK3o__6NVpdaBRcrpocM
REDIS_URL=redis://default:cOobifPnpRQzKfbxfOFVcadPaApiiZda@redis...
```

**Impacto**:
- ✗ Service Role Key = acesso TOTAL ao banco de dados
- ✗ Gemini API Key = custos ilimitados na sua conta Google
- ✗ Evolution API Key = controle do WhatsApp
- ✗ Se repositório vazou, credenciais estão comprometidas

### Plano de Correção

#### PASSO 1: Verificar se .env está no repositório

```bash
# Verificar se .env foi commitado
git log --all --full-history -- .env

# Se retornar algo = 🔴 FOI COMMITADO!
# Se não retornar nada = ✅ Nunca foi commitado
```

#### PASSO 2A: Se .env FOI commitado (🔴 CRÍTICO)

```bash
# 1. ROTACIONAR TODAS AS CREDENCIAIS IMEDIATAMENTE
echo "🔴 CREDENCIAIS COMPROMETIDAS - ROTACIONAR AGORA!"

# 2. Remover .env do histórico completo do git
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env" \
  --prune-empty --tag-name-filter cat -- --all

# 3. Forçar push (CUIDADO - coordenar com time)
git push origin --force --all
git push origin --force --tags

# 4. Limpar reflog local
rm -rf .git/refs/original/
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

**ATENÇÃO**: Se o repositório é público ou foi clonado por outras pessoas, considere as credenciais PERMANENTEMENTE comprometidas.

#### PASSO 2B: Se .env NUNCA foi commitado (✅ Melhor cenário)

```bash
# Apenas garantir que está no .gitignore
echo ".env" >> .gitignore
echo ".env.*" >> .gitignore
echo "!.env.example" >> .gitignore

git add .gitignore
git commit -m "chore: adiciona .env ao .gitignore"
```

#### PASSO 3: Criar arquivo .env.example (template)

```bash
# .env.example (pode ser versionado)
# Railway: Configure estas variáveis no Dashboard -> Variables

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Evolution API (WhatsApp)
EVOLUTION_API_URL=https://your-evolution-api.com
EVOLUTION_API_KEY=your_evolution_key_here
EVOLUTION_INSTANCE_NAME=your_instance_name

# Google APIs
GEMINI_API_KEY=your_gemini_key_here
GOOGLE_VISION_API_KEY=your_vision_key_here

# Redis (opcional - usa memória se não configurado)
REDIS_URL=redis://user:password@host:6379

# Segurança
CRON_SECRET=generate_random_secret_here

# Node
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
```

#### PASSO 4: Configurar variáveis no Railway

```bash
# 1. Acessar Railway Dashboard
# https://railway.app/project/<seu-projeto>/variables

# 2. Adicionar TODAS as variáveis do .env.example

# 3. Usar Railway CLI (alternativa)
railway variables set SUPABASE_URL "https://..."
railway variables set SUPABASE_SERVICE_ROLE_KEY "eyJ..."
railway variables set EVOLUTION_API_KEY "4C7..."
railway variables set GEMINI_API_KEY "AIza..."
railway variables set GOOGLE_VISION_API_KEY "AIza..."
railway variables set CRON_SECRET "$(openssl rand -hex 32)"
```

#### PASSO 5: ROTACIONAR todas as credenciais

##### 5.1 - Supabase Service Role Key

```bash
# 1. Acessar Supabase Dashboard
# https://supabase.com/dashboard/project/<seu-projeto>/settings/api

# 2. Gerar nova Service Role Key
# ⚠️ ATENÇÃO: Isso vai invalidar a chave antiga!

# 3. Atualizar no Railway
railway variables set SUPABASE_SERVICE_ROLE_KEY "nova_chave_aqui"

# 4. Reiniciar aplicação
railway up
```

##### 5.2 - Evolution API Key

```bash
# 1. Acessar Evolution API Dashboard
# 2. Gerar nova API Key
# 3. Atualizar no Railway
railway variables set EVOLUTION_API_KEY "nova_chave_aqui"
```

##### 5.3 - Google Gemini API Key

```bash
# 1. Acessar Google Cloud Console
# https://console.cloud.google.com/apis/credentials

# 2. Revogar chave antiga
# 3. Criar nova API Key
# 4. Restringir a API Key (IP whitelist se possível)
# 5. Atualizar no Railway
railway variables set GEMINI_API_KEY "nova_chave_aqui"
```

##### 5.4 - Google Vision API Key

```bash
# Mesmo processo do Gemini
# 1. Revogar chave antiga
# 2. Criar nova
# 3. Restringir
# 4. Atualizar Railway
railway variables set GOOGLE_VISION_API_KEY "nova_chave_aqui"
```

##### 5.5 - CRON Secret (gerar novo)

```bash
# Gerar secret forte
CRON_SECRET=$(openssl rand -hex 32)
echo "Novo CRON_SECRET: $CRON_SECRET"

# Atualizar Railway
railway variables set CRON_SECRET "$CRON_SECRET"
```

#### PASSO 6: Atualizar código para validar variáveis

```javascript
// src/config/env.js - MELHORAR validação

class EnvValidator {
  validate() {
    const required = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'EVOLUTION_API_URL',
      'EVOLUTION_API_KEY',
      'EVOLUTION_INSTANCE_NAME',
      'CRON_SECRET' // 🔴 Agora obrigatório!
    ];

    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      console.error('🔴 ERRO: Variáveis obrigatórias faltando:');
      missing.forEach(key => console.error(`   - ${key}`));

      // 🔴 SEMPRE falhar se variáveis críticas faltam
      if (process.env.NODE_ENV === 'production') {
        console.error('🔴 Produção requer todas as variáveis. Abortando.');
        process.exit(1);
      }

      return { valid: false, missing };
    }

    // Validar formato de URLs
    try {
      new URL(process.env.SUPABASE_URL);
      new URL(process.env.EVOLUTION_API_URL);
    } catch (err) {
      console.error('🔴 ERRO: URL inválida', err.message);
      process.exit(1);
    }

    // Validar comprimento de secrets
    if (process.env.CRON_SECRET.length < 32) {
      console.error('🔴 ERRO: CRON_SECRET muito curto (mínimo 32 caracteres)');
      process.exit(1);
    }

    console.log('✅ Todas as variáveis de ambiente validadas');
    return { valid: true };
  }
}

module.exports = new EnvValidator();
```

#### PASSO 7: Documentar processo para time

```markdown
# README.md - adicionar seção

## 🔐 Configuração de Variáveis de Ambiente

### Desenvolvimento Local

1. Copie o arquivo de exemplo:
   ```bash
   cp .env.example .env
   ```

2. Preencha as variáveis no `.env` com suas credenciais de desenvolvimento

3. **NUNCA comite o arquivo `.env`**

### Produção (Railway)

1. Configure as variáveis no Railway Dashboard:
   - Project → Variables

2. Variáveis obrigatórias:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `EVOLUTION_API_KEY`
   - `GEMINI_API_KEY`
   - `CRON_SECRET` (gere com: `openssl rand -hex 32`)

### Rotação de Credenciais

Rotacione as credenciais a cada 90 dias ou imediatamente se houver suspeita de vazamento.
```

#### PASSO 8: Setup de Secrets Scanning (GitHub)

```yaml
# .github/workflows/secrets-scan.yml
name: Secrets Scanning

on: [push, pull_request]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0 # Pega histórico completo

      - name: Run Gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Checklist de Validação

- [ ] Verificado se .env foi commitado (git log)
- [ ] Se sim: removido do histórico + credenciais rotacionadas
- [ ] .env adicionado ao .gitignore
- [ ] .env.example criado e commitado
- [ ] Todas as variáveis configuradas no Railway
- [ ] TODAS as credenciais rotacionadas (Supabase, Google, Evolution, CRON)
- [ ] Código atualizado para validar variáveis obrigatórias
- [ ] CRON_SECRET agora é obrigatório
- [ ] Documentação atualizada
- [ ] Secrets scanning configurado (GitHub Actions)
- [ ] Time notificado sobre novas credenciais
- [ ] Deploy testado em staging
- [ ] Confirmado que aplicação inicia sem .env local (só Railway vars)

**Tempo Estimado**: 3-6 horas (incluindo rotação de credenciais)

**CRÍTICO**: Se .env foi commitado em repositório PÚBLICO, considere TODAS as credenciais permanentemente comprometidas e tome ações adicionais de segurança.

---

## 🔴 VULNERABILIDADE #3: RLS (Row Level Security) Não Configurado

### Descrição do Problema

```sql
-- Estado atual: SEM RLS
-- Usuário A pode acessar dados do usuário B

SELECT * FROM atendimentos;
-- ⚠️ Retorna TODOS os atendimentos de TODOS os usuários!

SELECT * FROM contas_pagar;
-- ⚠️ Retorna TODAS as despesas de TODOS os usuários!
```

**Impacto**:
- ✗ Violação crítica de privacidade
- ✗ Vazamento de dados financeiros
- ✗ Não compliance com LGPD
- ✗ Qualquer usuário vê dados de outros

**Evidência**: Migrations de RLS foram deletadas do git
```bash
D  supabase/migrations/20251216000000_enable_rls_security.sql
D  supabase/migrations/20251216000001_fix_sql_functions_security.sql
```

### Plano de Correção

#### PASSO 1: Recuperar migrations deletadas

```bash
# Tentar recuperar do histórico git
git log --all --full-history -- supabase/migrations/*rls*.sql

# Se existir, recuperar
git show <commit-hash>:supabase/migrations/20251216000000_enable_rls_security.sql > supabase/migrations/20251216000000_enable_rls_security.sql
```

#### PASSO 2: Se migrations não existem, criar do zero

```sql
-- supabase/migrations/20260113000000_enable_rls_security.sql

-- ============================================================================
-- HABILITAR RLS EM TODAS AS TABELAS
-- ============================================================================

-- Tabela: profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Tabela: atendimentos (receitas/vendas)
ALTER TABLE atendimentos ENABLE ROW LEVEL SECURITY;

-- Tabela: contas_pagar (despesas)
ALTER TABLE contas_pagar ENABLE ROW LEVEL SECURITY;

-- Tabela: clientes
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;

-- Tabela: procedimentos
ALTER TABLE procedimentos ENABLE ROW LEVEL SECURITY;

-- Tabela: onboarding_progress
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

-- Tabela: mdr_configs
ALTER TABLE mdr_configs ENABLE ROW LEVEL SECURITY;

-- Tabela: ocr_jobs
ALTER TABLE ocr_jobs ENABLE ROW LEVEL SECURITY;

-- Tabela: user_insights
ALTER TABLE user_insights ENABLE ROW LEVEL SECURITY;

-- Tabela: analytics_events
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- POLICIES: profiles
-- ============================================================================

-- Usuário pode ver apenas seu próprio perfil
CREATE POLICY "Usuários podem ver próprio perfil"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Usuário pode atualizar apenas seu próprio perfil
CREATE POLICY "Usuários podem atualizar próprio perfil"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Service role pode ver tudo (necessário para backend)
CREATE POLICY "Service role acesso total profiles"
  ON profiles FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- POLICIES: atendimentos (receitas)
-- ============================================================================

-- Usuário vê apenas seus atendimentos
CREATE POLICY "Usuários veem próprios atendimentos"
  ON atendimentos FOR SELECT
  USING (profile_id = auth.uid());

-- Usuário pode inserir atendimentos para si
CREATE POLICY "Usuários inserem próprios atendimentos"
  ON atendimentos FOR INSERT
  WITH CHECK (profile_id = auth.uid());

-- Usuário pode atualizar apenas seus atendimentos
CREATE POLICY "Usuários atualizam próprios atendimentos"
  ON atendimentos FOR UPDATE
  USING (profile_id = auth.uid());

-- Usuário pode deletar apenas seus atendimentos
CREATE POLICY "Usuários deletam próprios atendimentos"
  ON atendimentos FOR DELETE
  USING (profile_id = auth.uid());

-- Service role acesso total
CREATE POLICY "Service role acesso total atendimentos"
  ON atendimentos FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- POLICIES: contas_pagar (despesas)
-- ============================================================================

CREATE POLICY "Usuários veem próprias contas"
  ON contas_pagar FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Usuários inserem próprias contas"
  ON contas_pagar FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Usuários atualizam próprias contas"
  ON contas_pagar FOR UPDATE
  USING (profile_id = auth.uid());

CREATE POLICY "Usuários deletam próprias contas"
  ON contas_agar FOR DELETE
  USING (profile_id = auth.uid());

CREATE POLICY "Service role acesso total contas_pagar"
  ON contas_pagar FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- POLICIES: clientes
-- ============================================================================

CREATE POLICY "Usuários veem próprios clientes"
  ON clientes FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Usuários inserem próprios clientes"
  ON clientes FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Usuários atualizam próprios clientes"
  ON clientes FOR UPDATE
  USING (profile_id = auth.uid());

CREATE POLICY "Usuários deletam próprios clientes"
  ON clientes FOR DELETE
  USING (profile_id = auth.uid());

CREATE POLICY "Service role acesso total clientes"
  ON clientes FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- POLICIES: procedimentos
-- ============================================================================

CREATE POLICY "Usuários veem próprios procedimentos"
  ON procedimentos FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Usuários inserem próprios procedimentos"
  ON procedimentos FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Usuários atualizam próprios procedimentos"
  ON procedimentos FOR UPDATE
  USING (profile_id = auth.uid());

CREATE POLICY "Usuários deletam próprios procedimentos"
  ON procedimentos FOR DELETE
  USING (profile_id = auth.uid());

CREATE POLICY "Service role acesso total procedimentos"
  ON procedimentos FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- POLICIES: onboarding_progress
-- ============================================================================

-- Usuário vê apenas seu onboarding (via phone que mapeia para profile_id)
CREATE POLICY "Usuários veem próprio onboarding"
  ON onboarding_progress FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.phone = onboarding_progress.phone
    )
  );

CREATE POLICY "Usuários atualizam próprio onboarding"
  ON onboarding_progress FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.phone = onboarding_progress.phone
    )
  );

CREATE POLICY "Service role acesso total onboarding"
  ON onboarding_progress FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- POLICIES: mdr_configs
-- ============================================================================

CREATE POLICY "Usuários veem próprias configs MDR"
  ON mdr_configs FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Usuários inserem próprias configs MDR"
  ON mdr_configs FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Usuários atualizam próprias configs MDR"
  ON mdr_configs FOR UPDATE
  USING (profile_id = auth.uid());

CREATE POLICY "Service role acesso total mdr_configs"
  ON mdr_configs FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- POLICIES: ocr_jobs
-- ============================================================================

CREATE POLICY "Usuários veem próprios OCR jobs"
  ON ocr_jobs FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Service role acesso total ocr_jobs"
  ON ocr_jobs FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- POLICIES: user_insights
-- ============================================================================

CREATE POLICY "Usuários veem próprios insights"
  ON user_insights FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Service role acesso total insights"
  ON user_insights FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- POLICIES: analytics_events
-- ============================================================================

CREATE POLICY "Usuários veem próprios eventos"
  ON analytics_events FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Service role acesso total analytics"
  ON analytics_events FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- VERIFICAÇÃO FINAL
-- ============================================================================

-- Lista todas as tabelas e status de RLS
SELECT
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Lista todas as policies criadas
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

#### PASSO 3: Aplicar migration

```bash
# 1. Via Supabase CLI (recomendado)
npx supabase db push

# 2. Via interface Supabase (alternativa)
# Dashboard → SQL Editor → Cole o SQL → Run

# 3. Via script Node.js
node scripts/apply-migrations.js
```

#### PASSO 4: Criar script de verificação de RLS

```javascript
// scripts/verify-rls.js

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyRLS() {
  console.log('🔍 Verificando RLS...\n');

  // Lista de tabelas que devem ter RLS
  const tables = [
    'profiles',
    'atendimentos',
    'contas_pagar',
    'clientes',
    'procedimentos',
    'onboarding_progress',
    'mdr_configs',
    'ocr_jobs',
    'user_insights',
    'analytics_events'
  ];

  // Verificar status RLS
  const { data: rlsStatus, error: rlsError } = await supabase
    .from('pg_tables')
    .select('tablename, rowsecurity')
    .eq('schemaname', 'public')
    .in('tablename', tables);

  if (rlsError) {
    console.error('❌ Erro ao verificar RLS:', rlsError);
    process.exit(1);
  }

  console.log('📊 Status de RLS por tabela:\n');
  let allEnabled = true;

  rlsStatus.forEach(table => {
    const status = table.rowsecurity ? '✅' : '❌';
    console.log(`${status} ${table.tablename}: ${table.rowsecurity ? 'ATIVO' : 'DESABILITADO'}`);
    if (!table.rowsecurity) allEnabled = false;
  });

  // Verificar policies
  const { data: policies, error: polError } = await supabase
    .from('pg_policies')
    .select('tablename, policyname, cmd')
    .eq('schemaname', 'public')
    .in('tablename', tables);

  console.log('\n📋 Policies por tabela:\n');
  tables.forEach(table => {
    const tablePolicies = policies.filter(p => p.tablename === table);
    console.log(`${table}: ${tablePolicies.length} policies`);
    tablePolicies.forEach(p => {
      console.log(`  - ${p.policyname} (${p.cmd})`);
    });
  });

  if (allEnabled) {
    console.log('\n✅ RLS está ativo em todas as tabelas!');
    process.exit(0);
  } else {
    console.log('\n❌ ERRO: RLS não está ativo em todas as tabelas');
    process.exit(1);
  }
}

verifyRLS();
```

#### PASSO 5: Teste de vazamento de dados

```javascript
// scripts/test-rls.js

const { createClient } = require('@supabase/supabase-js');

async function testRLS() {
  console.log('🧪 Testando RLS...\n');

  // Criar 2 usuários de teste
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // 1. Criar usuário A e inserir dados
  const { data: userA, error: errA } = await supabaseAdmin.auth.admin.createUser({
    email: 'test_user_a@example.com',
    password: 'test123',
    email_confirm: true
  });

  const supabaseA = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  await supabaseA.auth.signInWithPassword({
    email: 'test_user_a@example.com',
    password: 'test123'
  });

  // Inserir atendimento para usuário A
  const { data: atendA } = await supabaseA
    .from('atendimentos')
    .insert({
      profile_id: userA.user.id,
      valor: 1000,
      descricao: 'Atendimento privado de A'
    })
    .select()
    .single();

  console.log('✅ Usuário A criado e dados inseridos');

  // 2. Criar usuário B e tentar acessar dados de A
  const { data: userB } = await supabaseAdmin.auth.admin.createUser({
    email: 'test_user_b@example.com',
    password: 'test123',
    email_confirm: true
  });

  const supabaseB = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  await supabaseB.auth.signInWithPassword({
    email: 'test_user_b@example.com',
    password: 'test123'
  });

  // Tentar ler atendimento de A como usuário B
  const { data: leakedData } = await supabaseB
    .from('atendimentos')
    .select('*')
    .eq('id', atendA.id);

  if (leakedData && leakedData.length > 0) {
    console.log('❌ FALHA: Usuário B conseguiu ler dados de usuário A!');
    console.log('   Dados vazados:', leakedData);
    process.exit(1);
  } else {
    console.log('✅ SUCESSO: Usuário B NÃO conseguiu ler dados de usuário A');
  }

  // 3. Verificar que usuário B vê apenas seus dados
  await supabaseB
    .from('atendimentos')
    .insert({
      profile_id: userB.user.id,
      valor: 2000,
      descricao: 'Atendimento privado de B'
    });

  const { data: dataB } = await supabaseB
    .from('atendimentos')
    .select('*');

  if (dataB.length === 1 && dataB[0].profile_id === userB.user.id) {
    console.log('✅ SUCESSO: Usuário B vê apenas seus próprios dados');
  } else {
    console.log('❌ FALHA: Usuário B está vendo dados de outros usuários');
    process.exit(1);
  }

  // Cleanup
  await supabaseAdmin.auth.admin.deleteUser(userA.user.id);
  await supabaseAdmin.auth.admin.deleteUser(userB.user.id);

  console.log('\n✅ Todos os testes de RLS passaram!');
}

testRLS();
```

#### PASSO 6: Atualizar código backend para usar auth correto

```javascript
// src/middleware/authMiddleware.js

// ❌ REMOVER authenticateFlexible (permite telefone sem token)

// ✅ MANTER APENAS authenticate (obriga token JWT)
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];

    // Verificar token com Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    // Buscar perfil completo
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError) {
      return res.status(401).json({ error: 'Perfil não encontrado' });
    }

    req.user = profile;
    next();
  } catch (error) {
    logger.error('Erro na autenticação', { error });
    return res.status(401).json({ error: 'Falha na autenticação' });
  }
};

// ✅ Para webhook (que não tem usuário), criar middleware específico
const authenticateWebhook = async (req, res, next) => {
  // Validar signature HMAC (ver vulnerabilidade #5)
  const signature = req.headers['x-evolution-signature'];

  if (!validateSignature(req.body, signature)) {
    return res.status(401).json({ error: 'Signature inválida' });
  }

  next();
};

module.exports = { authenticate, authenticateWebhook };
```

### Checklist de Validação

- [ ] Migration de RLS criada ou recuperada
- [ ] Migration aplicada no Supabase
- [ ] Script de verificação executado (verify-rls.js)
- [ ] Todas as tabelas têm RLS ativo
- [ ] Todas as tabelas têm policies criadas
- [ ] Teste de vazamento executado (test-rls.js)
- [ ] Confirmado que usuário B NÃO vê dados de usuário A
- [ ] Código backend atualizado (removido authenticateFlexible)
- [ ] Todas as rotas usam authenticate correto
- [ ] Deploy em staging testado
- [ ] Teste manual com 2 contas reais
- [ ] Documentação atualizada

**Tempo Estimado**: 4-8 horas (incluindo testes extensivos)

---

## 🔴 VULNERABILIDADE #4: Autenticação Fraca (Fallback Telefone)

### Descrição do Problema

```javascript
// src/middleware/authMiddleware.js
const authenticateFlexible = async (req, res, next) => {
  // Tenta token JWT primeiro
  if (authHeader) {
    // ... validação JWT
  }

  // ❌ FALLBACK PERIGOSO: aceita apenas telefone
  const phone = req.headers['x-user-phone'] || req.query.phone;

  if (phone) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (profile) {
      req.user = profile;
      return next(); // ✅ Autenticado SEM senha!
    }
  }
};
```

**Impacto**:
- ✗ Qualquer pessoa que saiba o telefone de um usuário pode se passar por ele
- ✗ Basta enviar header `X-User-Phone: +5511999999999`
- ✗ Zero prova de identidade
- ✗ Viola LGPD (acesso não autorizado a dados pessoais)

### Plano de Correção

#### PASSO 1: Remover authenticateFlexible completamente

```javascript
// src/middleware/authMiddleware.js

// ❌ DELETAR ESTA FUNÇÃO:
// const authenticateFlexible = async (req, res, next) => { ... }

// ✅ MANTER APENAS:
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // 1. Token é OBRIGATÓRIO
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Tentativa de acesso sem token', {
        ip: req.ip,
        path: req.path
      });
      return res.status(401).json({
        error: 'Autenticação necessária',
        code: 'NO_TOKEN'
      });
    }

    const token = authHeader.split(' ')[1];

    // 2. Validar token com Supabase
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      logger.warn('Token inválido', {
        error: authError?.message,
        ip: req.ip
      });
      return res.status(401).json({
        error: 'Token inválido ou expirado',
        code: 'INVALID_TOKEN'
      });
    }

    // 3. Buscar perfil completo (com RLS ativo, só vai retornar se for o próprio)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      logger.error('Perfil não encontrado', {
        userId: user.id,
        error: profileError
      });
      return res.status(404).json({
        error: 'Perfil não encontrado',
        code: 'PROFILE_NOT_FOUND'
      });
    }

    // 4. Anexar usuário na request
    req.user = profile;
    req.auth = { userId: user.id, token };

    next();
  } catch (error) {
    logger.error('Erro na autenticação', {
      error: error.message,
      stack: error.stack,
      ip: req.ip
    });
    return res.status(500).json({
      error: 'Falha na autenticação',
      code: 'AUTH_ERROR'
    });
  }
};

module.exports = { authenticate };
```

#### PASSO 2: Criar middleware separado para webhook (sem usuário)

```javascript
// src/middleware/webhookAuth.js

const crypto = require('crypto');
const logger = require('../config/logger');

/**
 * Middleware de autenticação para webhook da Evolution API
 * Valida signature HMAC para garantir origem legítima
 */
const authenticateWebhook = (req, res, next) => {
  try {
    // 1. Verificar se tem signature header
    const signature = req.headers['x-evolution-signature'];

    if (!signature) {
      logger.warn('Webhook sem signature', {
        ip: req.ip,
        headers: req.headers
      });
      return res.status(401).json({
        error: 'Signature não fornecida',
        code: 'NO_SIGNATURE'
      });
    }

    // 2. Recalcular signature com o body
    const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.error('EVOLUTION_WEBHOOK_SECRET não configurado!');
      return res.status(500).json({
        error: 'Configuração inválida',
        code: 'CONFIG_ERROR'
      });
    }

    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    // 3. Comparar signatures (timing-safe)
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    if (!isValid) {
      logger.warn('Webhook com signature inválida', {
        ip: req.ip,
        receivedSignature: signature.substring(0, 10) + '...',
        expectedSignature: expectedSignature.substring(0, 10) + '...'
      });
      return res.status(401).json({
        error: 'Signature inválida',
        code: 'INVALID_SIGNATURE'
      });
    }

    // 4. Signature válida - prosseguir
    logger.debug('Webhook autenticado', { ip: req.ip });
    next();
  } catch (error) {
    logger.error('Erro ao validar webhook', {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      error: 'Falha na validação',
      code: 'VALIDATION_ERROR'
    });
  }
};

module.exports = { authenticateWebhook };
```

#### PASSO 3: Atualizar rotas que usavam authenticateFlexible

```javascript
// src/routes/dashboard.js

// ❌ ANTES:
router.get('/stats', authenticateFlexible, getDashboardStats);

// ✅ DEPOIS:
router.get('/stats', authenticate, getDashboardStats);
```

```javascript
// src/routes/onboarding.js

// ❌ ANTES:
router.get('/status', authenticateFlexible, getOnboardingStatus);

// ✅ DEPOIS:
router.get('/status', authenticate, getOnboardingStatus);
```

```javascript
// src/routes/user.js

// ❌ ANTES:
router.get('/profile', authenticateFlexible, getUserProfile);

// ✅ DEPOIS:
router.get('/profile', authenticate, getUserProfile);
```

```javascript
// src/routes/webhook.js

// ❌ ANTES: Sem autenticação
app.post('/api/webhook', async (req, res) => { ... });

// ✅ DEPOIS: Com validação de signature
const { authenticateWebhook } = require('../middleware/webhookAuth');

app.post('/api/webhook', authenticateWebhook, async (req, res) => { ... });
```

#### PASSO 4: Buscar TODAS as referências a authenticateFlexible

```bash
# Encontrar todas as ocorrências
grep -r "authenticateFlexible" src/

# Deve retornar:
# src/middleware/authMiddleware.js (definição)
# src/routes/*.js (vários usos)

# Substituir TODAS por authenticate
```

#### PASSO 5: Adicionar testes de autenticação

```javascript
// tests/auth.test.js

const request = require('supertest');
const app = require('../src/server');

describe('Authentication Middleware', () => {

  test('❌ Deve rejeitar requisição sem token', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .expect(401);

    expect(res.body.code).toBe('NO_TOKEN');
  });

  test('❌ Deve rejeitar token inválido', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', 'Bearer invalid_token_here')
      .expect(401);

    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  test('❌ Deve rejeitar telefone no header (sem token)', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('X-User-Phone', '+5511999999999')
      .expect(401);

    expect(res.body.code).toBe('NO_TOKEN');
  });

  test('✅ Deve aceitar token JWT válido', async () => {
    // Criar usuário de teste e pegar token
    const { token } = await createTestUser();

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveProperty('stats');
  });

  test('❌ Webhook sem signature deve ser rejeitado', async () => {
    const res = await request(app)
      .post('/api/webhook')
      .send({ message: 'test' })
      .expect(401);

    expect(res.body.code).toBe('NO_SIGNATURE');
  });

  test('❌ Webhook com signature inválida deve ser rejeitado', async () => {
    const res = await request(app)
      .post('/api/webhook')
      .set('X-Evolution-Signature', 'invalid_signature')
      .send({ message: 'test' })
      .expect(401);

    expect(res.body.code).toBe('INVALID_SIGNATURE');
  });

  test('✅ Webhook com signature válida deve ser aceito', async () => {
    const payload = { message: 'test' };
    const signature = generateValidSignature(payload);

    const res = await request(app)
      .post('/api/webhook')
      .set('X-Evolution-Signature', signature)
      .send(payload)
      .expect(200);
  });
});
```

#### PASSO 6: Configurar EVOLUTION_WEBHOOK_SECRET na Evolution API

```bash
# 1. Gerar secret forte
WEBHOOK_SECRET=$(openssl rand -hex 32)
echo "EVOLUTION_WEBHOOK_SECRET=$WEBHOOK_SECRET"

# 2. Configurar no Railway
railway variables set EVOLUTION_WEBHOOK_SECRET "$WEBHOOK_SECRET"

# 3. Configurar na Evolution API
# Docs: https://doc.evolution-api.com/v2/pt/integrate/webhook#autenticacao

# Via API:
curl -X POST https://your-evolution-api.com/webhook/config \
  -H "apikey: $EVOLUTION_API_KEY" \
  -d '{
    "url": "https://your-backend.railway.app/api/webhook",
    "enabled": true,
    "webhook_by_events": false,
    "events": ["messages.upsert"],
    "webhook_base64": false,
    "secret": "'$WEBHOOK_SECRET'"
  }'

# Via Dashboard Evolution API:
# Settings → Webhook → Secret: [cole o secret]
```

### Checklist de Validação

- [ ] authenticateFlexible deletado de authMiddleware.js
- [ ] authenticate (obrigatório JWT) implementado
- [ ] authenticateWebhook criado com validação HMAC
- [ ] Todas as rotas dashboard/* usam authenticate
- [ ] Todas as rotas onboarding/* usam authenticate
- [ ] Todas as rotas user/* usam authenticate
- [ ] Webhook usa authenticateWebhook
- [ ] EVOLUTION_WEBHOOK_SECRET gerado e configurado
- [ ] Evolution API configurada com secret
- [ ] Testes de autenticação criados e passando
- [ ] Teste manual: requisição sem token é rejeitada
- [ ] Teste manual: requisição com telefone é rejeitada
- [ ] Teste manual: webhook sem signature é rejeitado
- [ ] Deploy em staging testado
- [ ] Documentação atualizada

**Tempo Estimado**: 3-5 horas

---

## 🔴 VULNERABILIDADE #5: Webhook Sem Validação de Assinatura

### Descrição do Problema

```javascript
// src/routes/webhook.js

// ❌ VULNERÁVEL: Aceita de qualquer origem
app.post('/api/webhook', async (req, res) => {
  const body = req.body; // Processa diretamente

  // Qualquer pessoa pode enviar:
  // curl -X POST https://your-api.com/api/webhook \
  //   -H "Content-Type: application/json" \
  //   -d '{"message": "fake message", "from": "any_user"}'
});
```

**Impacto**:
- ✗ Qualquer pessoa pode enviar mensagens falsas
- ✗ Pode se passar por qualquer usuário
- ✗ Pode injetar comandos maliciosos
- ✗ DoS via flood de mensagens

**Solução**: Já foi coberta na vulnerabilidade #4 (authenticateWebhook). Vou complementar aqui com configuração da Evolution API.

### Plano de Correção (Complementar)

#### PASSO 1: Configurar webhook na Evolution API

```javascript
// scripts/setup-evolution-webhook.js

const axios = require('axios');

async function setupWebhook() {
  const config = {
    url: process.env.WEBHOOK_URL || 'https://your-backend.railway.app/api/webhook',
    enabled: true,
    webhook_by_events: true,
    webhook_base64: false, // Não enviar base64 no webhook (economiza banda)
    events: [
      'messages.upsert',    // Nova mensagem
      'messages.update',    // Mensagem editada
      'messages.delete',    // Mensagem deletada
      'connection.update'   // Status da conexão
    ],
    secret: process.env.EVOLUTION_WEBHOOK_SECRET
  };

  try {
    const response = await axios.post(
      `${process.env.EVOLUTION_API_URL}/webhook/${process.env.EVOLUTION_INSTANCE_NAME}`,
      config,
      {
        headers: {
          'apikey': process.env.EVOLUTION_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Webhook configurado com sucesso!');
    console.log('Config:', response.data);
  } catch (error) {
    console.error('❌ Erro ao configurar webhook:', error.response?.data || error.message);
    process.exit(1);
  }
}

setupWebhook();
```

#### PASSO 2: Validar configuração do webhook

```javascript
// scripts/verify-evolution-webhook.js

const axios = require('axios');
const crypto = require('crypto');

async function verifyWebhook() {
  try {
    // 1. Verificar configuração
    const response = await axios.get(
      `${process.env.EVOLUTION_API_URL}/webhook/${process.env.EVOLUTION_INSTANCE_NAME}`,
      {
        headers: {
          'apikey': process.env.EVOLUTION_API_KEY
        }
      }
    );

    const config = response.data;
    console.log('📋 Configuração atual do webhook:');
    console.log('  URL:', config.url);
    console.log('  Enabled:', config.enabled);
    console.log('  Events:', config.events);
    console.log('  Has Secret:', !!config.secret);

    // 2. Verificar se secret está configurado
    if (!config.secret) {
      console.log('\n❌ ERRO: Webhook sem secret!');
      console.log('Execute: node scripts/setup-evolution-webhook.js');
      process.exit(1);
    }

    // 3. Verificar se secret é o mesmo
    if (config.secret !== process.env.EVOLUTION_WEBHOOK_SECRET) {
      console.log('\n⚠️  AVISO: Secret no Evolution não confere com .env');
      console.log('Execute: node scripts/setup-evolution-webhook.js');
      process.exit(1);
    }

    console.log('\n✅ Webhook configurado corretamente!');
  } catch (error) {
    console.error('❌ Erro:', error.response?.data || error.message);
    process.exit(1);
  }
}

verifyWebhook();
```

#### PASSO 3: Teste de segurança do webhook

```javascript
// tests/webhook-security.test.js

const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/server');

describe('Webhook Security', () => {

  test('❌ Deve rejeitar webhook sem signature', async () => {
    const res = await request(app)
      .post('/api/webhook')
      .send({
        event: 'messages.upsert',
        data: { message: 'test' }
      })
      .expect(401);

    expect(res.body.code).toBe('NO_SIGNATURE');
  });

  test('❌ Deve rejeitar webhook com signature inválida', async () => {
    const res = await request(app)
      .post('/api/webhook')
      .set('X-Evolution-Signature', 'invalid_sig')
      .send({
        event: 'messages.upsert',
        data: { message: 'test' }
      })
      .expect(401);

    expect(res.body.code).toBe('INVALID_SIGNATURE');
  });

  test('❌ Deve rejeitar webhook com signature de body diferente', async () => {
    const originalBody = { event: 'messages.upsert', data: { message: 'original' } };
    const tamperedBody = { event: 'messages.upsert', data: { message: 'tampered' } };

    // Gerar signature do body original
    const signature = crypto
      .createHmac('sha256', process.env.EVOLUTION_WEBHOOK_SECRET)
      .update(JSON.stringify(originalBody))
      .digest('hex');

    // Enviar body adulterado
    const res = await request(app)
      .post('/api/webhook')
      .set('X-Evolution-Signature', signature)
      .send(tamperedBody)
      .expect(401);

    expect(res.body.code).toBe('INVALID_SIGNATURE');
  });

  test('✅ Deve aceitar webhook com signature válida', async () => {
    const body = {
      event: 'messages.upsert',
      instance: 'test-instance',
      data: {
        key: { remoteJid: '5511999999999@s.whatsapp.net' },
        message: { conversation: 'Hello' }
      }
    };

    const signature = crypto
      .createHmac('sha256', process.env.EVOLUTION_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');

    const res = await request(app)
      .post('/api/webhook')
      .set('X-Evolution-Signature', signature)
      .send(body)
      .expect(200);
  });

  test('❌ Deve detectar timing attack na comparação de signature', async () => {
    // Teste de timing-safe comparison
    const body = { test: 'data' };
    const correctSig = crypto
      .createHmac('sha256', process.env.EVOLUTION_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');

    const almostCorrectSig = correctSig.substring(0, correctSig.length - 1) + 'X';

    const start = process.hrtime.bigint();
    await request(app)
      .post('/api/webhook')
      .set('X-Evolution-Signature', almostCorrectSig)
      .send(body);
    const end = process.hrtime.bigint();

    const timeDiff = Number(end - start) / 1000000; // ms

    // Timing deve ser constante (< 10ms variação)
    // Se > 100ms, pode ter timing leak
    expect(timeDiff).toBeLessThan(100);
  });
});
```

#### PASSO 4: Rate limiting específico para webhook

```javascript
// src/middleware/webhookRateLimit.js

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');
const logger = require('../config/logger');

// Limitar webhook por IP (prevenir flood)
const webhookRateLimit = rateLimit({
  store: process.env.REDIS_URL ? new RedisStore({
    client: new Redis(process.env.REDIS_URL),
    prefix: 'webhook_rl:'
  }) : undefined,

  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 60, // 60 requisições por minuto = 1/segundo

  message: {
    error: 'Muitas requisições ao webhook',
    code: 'RATE_LIMIT_EXCEEDED'
  },

  standardHeaders: true,
  legacyHeaders: false,

  handler: (req, res) => {
    logger.warn('Webhook rate limit excedido', {
      ip: req.ip,
      headers: req.headers
    });
    res.status(429).json({
      error: 'Muitas requisições',
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }
});

module.exports = { webhookRateLimit };
```

```javascript
// src/routes/webhook.js

const { authenticateWebhook } = require('../middleware/webhookAuth');
const { webhookRateLimit } = require('../middleware/webhookRateLimit');

// Aplicar rate limit E autenticação
app.post('/api/webhook',
  webhookRateLimit,        // 1. Rate limit primeiro
  authenticateWebhook,     // 2. Depois autenticação
  async (req, res) => {    // 3. Processar
    // ...
  }
);
```

### Checklist de Validação

- [ ] authenticateWebhook implementado (ver vulnerabilidade #4)
- [ ] EVOLUTION_WEBHOOK_SECRET configurado
- [ ] Script setup-evolution-webhook.js executado
- [ ] Evolution API configurada com secret
- [ ] Script verify-evolution-webhook.js executado e passou
- [ ] Webhook rate limiting configurado
- [ ] Testes de segurança criados e passando
- [ ] Teste timing-safe comparison
- [ ] Teste manual: webhook sem signature rejeitado
- [ ] Teste manual: webhook com signature válida aceito
- [ ] Deploy em staging testado
- [ ] Webhook real da Evolution API funcionando

**Tempo Estimado**: 2-3 horas (já coberto na #4, só configuração)

---

## 🔴 VULNERABILIDADE #6: Uploads Sem Validação

### Descrição do Problema

```javascript
// src/routes/webhook.js

// ❌ VULNERÁVEL:
app.use(express.json({ limit: '10mb' })); // Aceita até 10MB

// webhook.js
const base64Data = message.imageMessage?.base64;
if (base64Data) {
  const imageBuffer = Buffer.from(base64Data, 'base64'); // SEM validação!
  // Envia para Google Vision...
}

// mdrOcrService.js
async downloadImage(imageUrl) {
  const res = await axios.get(imageUrl, { // ❌ URL não validada
    responseType: 'arraybuffer'
  });
  return Buffer.from(res.data);
}
```

**Impacto**:
- ✗ DoS via imagens gigantes (10MB * muitos usuários)
- ✗ SSRF via URL maliciosa (acessar rede interna)
- ✗ Possível RCE via exploits de processamento de imagem
- ✗ Custos Google Vision (processar imagens maliciosas)

### Plano de Correção

#### PASSO 1: Criar middleware de validação de imagens

```javascript
// src/middleware/imageValidation.js

const sharp = require('sharp');
const logger = require('../config/logger');

// Tipos MIME permitidos
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
];

// Limites
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DIMENSION = 4096; // 4096x4096 pixels
const MIN_DIMENSION = 50; // 50x50 pixels

/**
 * Valida buffer de imagem
 */
async function validateImageBuffer(buffer, context = {}) {
  try {
    // 1. Verificar tamanho
    if (buffer.length > MAX_FILE_SIZE) {
      logger.warn('Imagem muito grande', {
        size: buffer.length,
        maxSize: MAX_FILE_SIZE,
        ...context
      });
      throw new Error(`Imagem muito grande (máximo ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    // 2. Verificar se é realmente uma imagem (usando sharp)
    let metadata;
    try {
      metadata = await sharp(buffer).metadata();
    } catch (err) {
      logger.warn('Arquivo não é uma imagem válida', {
        error: err.message,
        ...context
      });
      throw new Error('Arquivo não é uma imagem válida');
    }

    // 3. Verificar MIME type
    const mimeType = `image/${metadata.format}`;
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      logger.warn('Tipo de imagem não permitido', {
        mimeType,
        allowed: ALLOWED_MIME_TYPES,
        ...context
      });
      throw new Error(`Tipo não permitido (permitidos: ${ALLOWED_MIME_TYPES.join(', ')})`);
    }

    // 4. Verificar dimensões
    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
      logger.warn('Dimensões da imagem muito grandes', {
        width: metadata.width,
        height: metadata.height,
        max: MAX_DIMENSION,
        ...context
      });
      throw new Error(`Dimensões muito grandes (máximo ${MAX_DIMENSION}x${MAX_DIMENSION})`);
    }

    if (metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION) {
      logger.warn('Dimensões da imagem muito pequenas', {
        width: metadata.width,
        height: metadata.height,
        min: MIN_DIMENSION,
        ...context
      });
      throw new Error(`Dimensões muito pequenas (mínimo ${MIN_DIMENSION}x${MIN_DIMENSION})`);
    }

    // 5. Verificar se tem múltiplas páginas (potencial exploit)
    if (metadata.pages && metadata.pages > 1) {
      logger.warn('Imagem com múltiplas páginas', {
        pages: metadata.pages,
        ...context
      });
      throw new Error('Imagens com múltiplas páginas não são permitidas');
    }

    // 6. Sanitizar: reprocessar imagem para remover metadados/exploits
    const sanitized = await sharp(buffer)
      .removeAlpha() // Remove canal alpha
      .jpeg({ quality: 90 }) // Reconverter para JPEG
      .toBuffer();

    logger.info('Imagem validada com sucesso', {
      originalSize: buffer.length,
      sanitizedSize: sanitized.length,
      dimensions: `${metadata.width}x${metadata.height}`,
      format: metadata.format,
      ...context
    });

    return {
      valid: true,
      buffer: sanitized,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: sanitized.length
      }
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Valida base64 de imagem
 */
async function validateBase64Image(base64Data, context = {}) {
  try {
    // 1. Verificar tamanho antes de decodificar
    const estimatedSize = (base64Data.length * 3) / 4;
    if (estimatedSize > MAX_FILE_SIZE) {
      throw new Error('Base64 muito grande');
    }

    // 2. Decodificar
    const buffer = Buffer.from(base64Data, 'base64');

    // 3. Validar buffer
    return await validateImageBuffer(buffer, context);
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Valida URL de imagem (anti-SSRF)
 */
function validateImageUrl(url) {
  try {
    const parsed = new URL(url);

    // 1. Apenas HTTPS
    if (parsed.protocol !== 'https:') {
      throw new Error('Apenas URLs HTTPS são permitidas');
    }

    // 2. Blacklist de IPs internos
    const hostname = parsed.hostname.toLowerCase();

    // IPs privados
    const privatePatterns = [
      /^localhost$/i,
      /^127\.\d+\.\d+\.\d+$/,
      /^10\.\d+\.\d+\.\d+$/,
      /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
      /^192\.168\.\d+\.\d+$/,
      /^169\.254\.\d+\.\d+$/, // Link-local
      /^::1$/, // IPv6 localhost
      /^fe80:/i, // IPv6 link-local
      /^fc00:/i, // IPv6 private
    ];

    for (const pattern of privatePatterns) {
      if (pattern.test(hostname)) {
        throw new Error('URL aponta para rede privada');
      }
    }

    // 3. Whitelist de domínios conhecidos (opcional)
    const allowedDomains = [
      'evolution-api.com',
      'githubusercontent.com',
      // Adicionar domínios confiáveis
    ];

    const isAllowed = allowedDomains.some(domain =>
      hostname === domain || hostname.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
      logger.warn('URL de domínio não confiável', { url: hostname });
      // Pode rejeitar ou apenas logar (depende da política)
    }

    return { valid: true, url: parsed.href };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

module.exports = {
  validateImageBuffer,
  validateBase64Image,
  validateImageUrl,
  MAX_FILE_SIZE,
  MAX_DIMENSION,
  ALLOWED_MIME_TYPES
};
```

#### PASSO 2: Aplicar validação no webhook

```javascript
// src/routes/webhook.js

const { validateBase64Image } = require('../middleware/imageValidation');

app.post('/api/webhook',
  webhookRateLimit,
  authenticateWebhook,
  async (req, res) => {
    try {
      const { message } = extractMessageData(req.body);

      // Se tem imagem, validar
      if (message.imageMessage) {
        const base64Data = message.imageMessage.base64;

        if (base64Data) {
          // ✅ VALIDAR antes de processar
          const validation = await validateBase64Image(base64Data, {
            phone,
            messageId: message.key.id
          });

          if (!validation.valid) {
            logger.warn('Imagem inválida recebida', {
              phone,
              error: validation.error
            });

            // Notificar usuário
            await evolutionApiService.sendMessage(phone,
              '❌ Imagem inválida. Por favor, envie uma imagem JPG ou PNG de até 5MB.'
            );

            return res.status(200).json({
              success: false,
              error: validation.error
            });
          }

          // Usar buffer sanitizado
          const sanitizedBuffer = validation.buffer;

          // Processar OCR com imagem validada
          await documentHandler.handle(phone, message, sanitizedBuffer);
        }
      }

      // ... resto do processamento

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('Erro no webhook', { error });
      res.status(500).json({ error: 'Erro ao processar' });
    }
  }
);
```

#### PASSO 3: Aplicar validação no download de URLs

```javascript
// src/services/mdrOcrService.js

const axios = require('axios');
const { validateImageUrl, validateImageBuffer } = require('../middleware/imageValidation');

async downloadImage(imageUrl) {
  // ✅ VALIDAR URL primeiro (anti-SSRF)
  const urlValidation = validateImageUrl(imageUrl);

  if (!urlValidation.valid) {
    logger.error('URL inválida para download', {
      url: imageUrl,
      error: urlValidation.error
    });
    throw new Error(`URL inválida: ${urlValidation.error}`);
  }

  try {
    const response = await axios.get(urlValidation.url, {
      responseType: 'arraybuffer',
      timeout: 10000, // 10s timeout
      maxContentLength: 5 * 1024 * 1024, // 5MB
      maxRedirects: 3,
      headers: {
        'User-Agent': 'LumizBot/1.0'
      }
    });

    const buffer = Buffer.from(response.data);

    // ✅ VALIDAR buffer baixado
    const validation = await validateImageBuffer(buffer, {
      source: 'download',
      url: imageUrl
    });

    if (!validation.valid) {
      throw new Error(`Imagem baixada inválida: ${validation.error}`);
    }

    logger.info('Imagem baixada e validada', {
      url: imageUrl,
      size: validation.metadata.size
    });

    return validation.buffer; // Retorna buffer sanitizado
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      logger.error('Erro de rede ao baixar imagem', {
        url: imageUrl,
        code: error.code
      });
      throw new Error('Não foi possível baixar a imagem');
    }
    throw error;
  }
}
```

#### PASSO 4: Rate limiting por usuário para uploads

```javascript
// src/middleware/userRateLimit.js

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');

// Rate limit para uploads de imagem por usuário
const imageUploadRateLimit = rateLimit({
  store: process.env.REDIS_URL ? new RedisStore({
    client: new Redis(process.env.REDIS_URL),
    prefix: 'img_rl:'
  }) : undefined,

  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20, // 20 imagens por 15 minutos

  keyGenerator: (req) => {
    // Rate limit por usuário (não por IP)
    return req.user?.phone || req.ip;
  },

  message: {
    error: 'Você atingiu o limite de uploads de imagens. Tente novamente em 15 minutos.',
    code: 'IMAGE_RATE_LIMIT'
  },

  handler: (req, res) => {
    logger.warn('Rate limit de imagens excedido', {
      phone: req.user?.phone,
      ip: req.ip
    });
    res.status(429).json({
      error: 'Muitos uploads de imagens',
      code: 'IMAGE_RATE_LIMIT'
    });
  }
});

module.exports = { imageUploadRateLimit };
```

#### PASSO 5: Adicionar testes de validação

```javascript
// tests/image-validation.test.js

const { validateImageBuffer, validateBase64Image, validateImageUrl } = require('../src/middleware/imageValidation');
const fs = require('fs');
const path = require('path');

describe('Image Validation', () => {

  test('✅ Deve aceitar JPEG válido', async () => {
    const buffer = fs.readFileSync(path.join(__dirname, 'fixtures/valid.jpg'));
    const result = await validateImageBuffer(buffer);

    expect(result.valid).toBe(true);
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.metadata.format).toBe('jpeg');
  });

  test('✅ Deve aceitar PNG válido', async () => {
    const buffer = fs.readFileSync(path.join(__dirname, 'fixtures/valid.png'));
    const result = await validateImageBuffer(buffer);

    expect(result.valid).toBe(true);
  });

  test('❌ Deve rejeitar arquivo não-imagem', async () => {
    const buffer = Buffer.from('not an image');
    const result = await validateImageBuffer(buffer);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('não é uma imagem válida');
  });

  test('❌ Deve rejeitar imagem muito grande', async () => {
    // Criar buffer de 6MB (acima do limite de 5MB)
    const largeBuffer = Buffer.alloc(6 * 1024 * 1024);
    const result = await validateImageBuffer(largeBuffer);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('muito grande');
  });

  test('❌ Deve rejeitar base64 malicioso', async () => {
    const maliciousBase64 = 'A'.repeat(10 * 1024 * 1024); // 10MB de 'A'
    const result = await validateBase64Image(maliciousBase64);

    expect(result.valid).toBe(false);
  });

  test('❌ Deve rejeitar URL localhost (SSRF)', () => {
    const result = validateImageUrl('http://localhost:8080/image.jpg');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('privada');
  });

  test('❌ Deve rejeitar URL 127.0.0.1 (SSRF)', () => {
    const result = validateImageUrl('https://127.0.0.1/secret');

    expect(result.valid).toBe(false);
  });

  test('❌ Deve rejeitar URL rede privada 192.168 (SSRF)', () => {
    const result = validateImageUrl('https://192.168.1.1/admin');

    expect(result.valid).toBe(false);
  });

  test('❌ Deve rejeitar URL HTTP (não HTTPS)', () => {
    const result = validateImageUrl('http://example.com/image.jpg');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('HTTPS');
  });

  test('✅ Deve aceitar URL HTTPS pública', () => {
    const result = validateImageUrl('https://example.com/image.jpg');

    expect(result.valid).toBe(true);
  });

  test('✅ Deve sanitizar imagem (remover metadados)', async () => {
    // Imagem com EXIF data
    const bufferWithExif = fs.readFileSync(path.join(__dirname, 'fixtures/with-exif.jpg'));
    const result = await validateImageBuffer(bufferWithExif);

    expect(result.valid).toBe(true);

    // Buffer sanitizado não deve ter EXIF
    const sharp = require('sharp');
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.exif).toBeUndefined();
  });
});
```

### Checklist de Validação

- [ ] imageValidation.js criado com todas as validações
- [ ] Validação aplicada no webhook (base64)
- [ ] Validação aplicada no download de URLs
- [ ] Rate limiting de uploads por usuário implementado
- [ ] SSRF prevention testado (localhost, 127.0.0.1, 192.168.x.x)
- [ ] Testes de validação criados e passando
- [ ] Teste com imagem > 5MB (deve rejeitar)
- [ ] Teste com arquivo não-imagem (deve rejeitar)
- [ ] Teste com URL maliciosa (deve rejeitar)
- [ ] Teste com imagem válida (deve aceitar e sanitizar)
- [ ] Deploy em staging testado
- [ ] Teste manual com imagem real via WhatsApp

**Tempo Estimado**: 4-6 horas

---

## 📊 RESUMO DO PLANO DE AÇÃO

### Cronograma Sugerido

```
SEMANA 1:
├── Dia 1-2: Vulnerabilidade #1 (Debug logging) + #2 (Secrets)
│   ├── Remover 31 instâncias de fetch debug
│   ├── Rotacionar TODAS as credenciais
│   └── Configurar secrets no Railway
│
├── Dia 3-4: Vulnerabilidade #3 (RLS)
│   ├── Criar migrations de RLS
│   ├── Aplicar no Supabase
│   └── Testar isolamento de dados
│
└── Dia 5: Vulnerabilidade #4 (Auth)
    ├── Remover authenticateFlexible
    ├── Implementar authenticate obrigatório
    └── Criar authenticateWebhook

SEMANA 2:
├── Dia 1-2: Vulnerabilidade #5 (Webhook) + #6 (Uploads)
│   ├── Configurar webhook signature
│   ├── Implementar validação de imagens
│   └── Anti-SSRF
│
├── Dia 3-4: Testes e Validação
│   ├── Executar todos os testes
│   ├── Testes de segurança
│   └── Testes manuais
│
└── Dia 5: Deploy e Documentação
    ├── Deploy em staging
    ├── Testes em produção (canary)
    └── Documentação finalizada
```

### Ordem de Execução

```
BLOCO 1 (Urgente): #1, #2
  ↓
BLOCO 2 (Crítico): #3, #4
  ↓
BLOCO 3 (Importante): #5, #6
  ↓
BLOCO 4 (Validação): Testes + Deploy
```

### Estimativa de Tempo Total

| Fase | Tempo | Dias |
|------|-------|------|
| Bloco 1 (Debug + Secrets) | 5-10h | 1-2 dias |
| Bloco 2 (RLS + Auth) | 7-13h | 2-3 dias |
| Bloco 3 (Webhook + Uploads) | 6-9h | 2 dias |
| Bloco 4 (Testes + Deploy) | 4-6h | 1-2 dias |
| **TOTAL** | **22-38h** | **6-9 dias úteis** |

**Com dedicação full-time**: 2 semanas
**Com dedicação part-time**: 3-4 semanas

---

## ✅ CRITÉRIOS DE ACEITAÇÃO

### Antes de liberar para usuários, TODAS as seguintes condições devem ser verdadeiras:

**Segurança:**
- [ ] Zero instâncias de fetch para localhost:7242
- [ ] Todas as credenciais rotacionadas
- [ ] .env não está no git (verificado com git log)
- [ ] RLS ativo em todas as tabelas
- [ ] RLS testado (usuário B não vê dados de usuário A)
- [ ] Autenticação obrigatória (JWT) em todas as rotas
- [ ] Webhook com validação de signature
- [ ] Uploads validados (MIME type, tamanho, dimensões)
- [ ] Anti-SSRF implementado

**Qualidade:**
- [ ] Todos os testes passando (unit + integration + security)
- [ ] Código sem warnings críticos do ESLint
- [ ] Logs não contém dados sensíveis
- [ ] Rate limiting ativo e testado

**Operacional:**
- [ ] Deploy em staging bem-sucedido
- [ ] Teste manual com 2 usuários reais
- [ ] Health check passando
- [ ] Monitoring configurado (logs, erros)
- [ ] Documentação atualizada

**Compliance:**
- [ ] LGPD: dados isolados por usuário (RLS)
- [ ] LGPD: sem vazamento de dados sensíveis
- [ ] Secrets management correto
- [ ] Audit trail de ações críticas

---

## 🆘 CONTATO E SUPORTE

Se precisar de ajuda durante a implementação:

1. **Para cada vulnerabilidade**, execute os scripts de verificação
2. **Para cada correção**, execute os testes automatizados
3. **Antes de deploy**, execute checklist completo
4. **Em caso de dúvida**, priorize segurança sobre funcionalidade

---

## 📚 REFERÊNCIAS

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- Supabase RLS: https://supabase.com/docs/guides/auth/row-level-security
- Evolution API Webhook: https://doc.evolution-api.com/v2/pt/integrate/webhook
- LGPD Brasil: http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- Express Security: https://expressjs.com/en/advanced/best-practice-security.html

---

**Data de criação**: 2026-01-13
**Última atualização**: 2026-01-13
**Status**: 🟡 EM PROGRESSO
**Próxima revisão**: Após conclusão do Bloco 1
