# Como Resolver Erro "fetch failed" no Railway

## O Problema

Quando alguém envia uma mensagem no WhatsApp, o sistema tenta buscar o usuário no Supabase mas a conexão falha:

```
TypeError: fetch failed
    at UserController.findUserByPhone (/app/src/controllers/userController.js:39:57)
```

Resultado: usuário recebe "Eita, deu um erro aqui 😅"

## Causa Raiz

O Supabase client não consegue se conectar ao servidor. Pode ser:

1. ❌ Variáveis de ambiente não configuradas no Railway
2. ❌ Problema de rede/DNS no Railway
3. ❌ URL ou chave incorreta

---

## Solução: Passo a Passo

### 1️⃣ Verificar Variáveis de Ambiente no Railway

1. Acesse o projeto no Railway
2. Vá em **Variables**
3. Confirme que estas variáveis existem e estão corretas:

```bash
SUPABASE_URL=https://whmbyfnwnlbrfmgdwdfw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobWJ5Zm53bmxicmZtZ2R3ZGZ3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTkxNzg3MCwiZXhwIjoyMDc3NDkzODcwfQ.7fTwCPv7I6ZasEDAHsQ90MMdjfiPNqy_bvsOk5UwTds
```

**Se não estiverem configuradas:**
- Adicione as variáveis
- Faça redeploy do serviço

### 2️⃣ Testar Conectividade no Railway

Execute o script de diagnóstico **diretamente no Railway**:

```bash
node scripts/test-supabase-connection.js
```

Este script vai testar:
- ✅ Variáveis de ambiente configuradas
- ✅ URL válida
- ✅ DNS resolution
- ✅ Conexão HTTP com Supabase
- ✅ Query real no banco

**Como rodar no Railway:**

#### Opção A: Railway CLI
```bash
# Instalar Railway CLI
npm i -g @railway/cli

# Login
railway login

# Conectar ao projeto
railway link

# Executar comando
railway run node scripts/test-supabase-connection.js
```

#### Opção B: Adicionar comando temporário
1. No Railway, vá em **Settings** > **Deploy**
2. Mude o **Start Command** temporariamente para:
   ```
   node scripts/test-supabase-connection.js
   ```
3. Faça redeploy
4. Veja os logs para resultado do teste
5. Volte o Start Command para: `node src/index.js`

### 3️⃣ Verificar Logs no Railway

Verifique os logs de startup do serviço. Procure por:

```
❌ ERRO: Variáveis de ambiente obrigatórias não configuradas
```

ou

```
[CACHE] ❌ Erro no Redis: ...
```

### 4️⃣ Verificar Configuração do Supabase

1. Acesse o painel do Supabase: https://supabase.com/dashboard
2. Vá no projeto `whmbyfnwnlbrfmgdwdfw`
3. Em **Settings** > **API**, confirme:
   - URL: `https://whmbyfnwnlbrfmgdwdfw.supabase.co`
   - Service Role Key (corresponde à configurada)

### 5️⃣ Verificar se Supabase está Online

Teste manualmente se o Supabase está respondendo:

```bash
curl https://whmbyfnwnlbrfmgdwdfw.supabase.co/rest/v1/
```

Deve retornar um JSON (mesmo que vazio ou com erro de auth).

---

## Testes Locais

Para garantir que funciona localmente:

```bash
# Rodar script de teste local
node scripts/test-supabase-connection.js

# Deve mostrar:
# ✅ TODOS OS TESTES PASSARAM!
```

---

## Próximos Passos

Depois de resolver:

1. ✅ Verifique se as variáveis estão corretas no Railway
2. ✅ Rode o script de diagnóstico no Railway
3. ✅ Envie uma mensagem de teste no WhatsApp
4. ✅ Verifique os logs do Railway

---

## Se Nada Funcionar

### Fallback: Adicionar Retry Logic

Se o problema persistir (ex: Railway com problema de DNS intermitente), podemos adicionar retry na conexão do Supabase.

Edite `src/db/supabase.js`:

```javascript
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
require('dotenv').config();

// Retry fetch wrapper
const fetchWithRetry = async (url, options, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`[SUPABASE] Retry ${i + 1}/${retries} após erro: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    global: {
      fetch: fetchWithRetry
    }
  }
);

module.exports = supabase;
```

Mas **faça isso apenas como último recurso**. O ideal é resolver a causa raiz.

---

## Contato

Se precisar de ajuda, compartilhe:
1. Logs completos do Railway (especialmente startup)
2. Resultado do script `test-supabase-connection.js`
3. Screenshot das variáveis de ambiente no Railway
