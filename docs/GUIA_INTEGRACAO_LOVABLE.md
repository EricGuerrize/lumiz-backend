# Guia de Integração: Bot WhatsApp + Lovable Cloud

## Status Atual

✅ **Backend adaptado** para usar tabelas do Lovable Cloud:
- `whatsapp_users` (já existe no Lovable)
- `whatsapp_transactions` (precisa criar)
- `whatsapp_categories` (precisa criar)

---

## PASSO 1: Criar Tabelas no Lovable

### Opção A: Usar o SQL Editor do Supabase

1. Acesse: https://supabase.com/dashboard
2. Selecione o projeto: `kzaedkuolcevdjdugtfn`
3. Vá em **SQL Editor**
4. Cole e execute o script: `docs/SQL_MIGRATION_LOVABLE.sql`

### Opção B: Pedir para o Lovable AI

Cole este prompt no Lovable:

```
Por favor, execute o seguinte SQL no Supabase para criar as tabelas necessárias para integração com o bot WhatsApp:

CREATE TABLE IF NOT EXISTS whatsapp_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES whatsapp_users(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL CHECK (type IN ('entrada', 'saida')),
  amount DECIMAL(10,2) NOT NULL,
  category VARCHAR(100) DEFAULT 'Sem categoria',
  description TEXT,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES whatsapp_users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('entrada', 'saida')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_transactions_user_id ON whatsapp_transactions(user_id);
CREATE INDEX idx_whatsapp_transactions_date ON whatsapp_transactions(date);

Também preciso da Service Role Key para configurar o backend. Onde posso encontrá-la?
```

---

## PASSO 2: Configurar Credenciais no Railway

1. Acesse o dashboard do Railway
2. Vá em **Variables**
3. Atualize as variáveis:

```env
# Lovable Cloud Supabase
SUPABASE_URL=https://kzaedkuolcevdjdugtfn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Manter as outras variáveis
EVOLUTION_API_URL=sua_url
EVOLUTION_API_KEY=sua_chave
GOOGLE_API_KEY=sua_chave_gemini
NODE_ENV=production
```

### Onde encontrar a Service Role Key:

1. Supabase Dashboard > Settings > API
2. Em "Service role key" (NÃO anon key)
3. Copie a chave completa

---

## PASSO 3: Deploy no Railway

```bash
git add .
git commit -m "feat: Adapt bot for Lovable Cloud integration"
git push origin main
```

O Railway fará deploy automático.

---

## PASSO 4: Testar a Integração

### Teste 1: Registrar transação via WhatsApp

Envie para o bot:
```
Botox 2800 paciente Maria
```

Resposta esperada:
```
✅ *VENDA REGISTRADA*
💰 R$ 2.800,00
📁 Botox
📝 paciente Maria
📅 16/11/2025
```

### Teste 2: Verificar no Supabase

```sql
SELECT * FROM whatsapp_transactions ORDER BY created_at DESC LIMIT 1;
```

Deve mostrar a transação registrada.

### Teste 3: API do Dashboard

```bash
curl -X GET "https://SEU-BACKEND.railway.app/api/dashboard/summary" \
  -H "x-user-phone: 5511999999999"
```

Resposta:
```json
{
  "receitas": 2800.00,
  "custos": 0,
  "lucro": 2800.00,
  "margemLucro": 100,
  "saldo": 2800.00
}
```

---

## PASSO 5: Conectar Dashboard Lovable

Cole este prompt no Lovable:

```
Preciso conectar o dashboard ao meu backend Railway para mostrar dados financeiros do bot WhatsApp.

O backend já está configurado com estes endpoints:

BASE_URL: https://SEU-BACKEND.railway.app

Endpoints disponíveis:
- GET /api/dashboard/summary
- GET /api/dashboard/transactions?limit=10
- GET /api/dashboard/monthly-report?year=2025&month=11
- GET /api/dashboard/categories
- GET /api/dashboard/stats/by-category
- GET /api/dashboard/stats/timeline
- GET /api/dashboard/stats/comparison
- GET /api/dashboard/stats/averages
- GET /api/dashboard/stats/kpis
- GET /api/dashboard/user

Autenticação: Header "x-user-phone" com número do WhatsApp (ex: "5511999999999")

Por favor:
1. Crie uma página de login que peça o número do WhatsApp
2. Salve o número no localStorage ou context
3. Use esse número para fazer requisições à API
4. Mostre os dados nos cards e gráficos existentes

Exemplo de código para fetch:
const response = await fetch(`${BASE_URL}/api/dashboard/summary`, {
  headers: { 'x-user-phone': userPhone }
});
const data = await response.json();
```

---

## Estrutura Final

```
WhatsApp (usuário)
    ↓
Evolution API (recebe mensagem)
    ↓
Railway Backend (processa com Gemini)
    ↓
Lovable Cloud Supabase (armazena dados)
    ↑
Railway Backend (API REST)
    ↑
Lovable Dashboard (exibe dados)
```

---

## Arquivos Modificados

1. **`src/controllers/userController.js`**
   - Usa `whatsapp_users` e `whatsapp_categories`

2. **`src/controllers/transactionController.js`**
   - Usa `whatsapp_transactions`
   - Categoria como string (não FK)

3. **`src/routes/dashboard.routes.js`**
   - API completa para dashboard
   - Autenticação por telefone

4. **`.env`** (Railway)
   - Credenciais do Lovable Supabase

---

## Troubleshooting

### Erro: "relation whatsapp_transactions does not exist"
**Solução:** Execute o SQL de migração no Supabase

### Erro: "new row violates foreign key constraint"
**Solução:** Verifique se whatsapp_users tem a coluna `phone`

### CORS Error
**Solução:** Já configurado no `server.js` para domínios Lovable

### "Authentication failed"
**Solução:** Verifique Service Role Key no Railway

---

## Checklist Final

- [ ] SQL executado no Lovable Supabase
- [ ] Service Role Key copiada
- [ ] Variáveis atualizadas no Railway
- [ ] Deploy realizado
- [ ] Teste via WhatsApp ok
- [ ] Teste da API ok
- [ ] Dashboard conectado
