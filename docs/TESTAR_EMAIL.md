# 🧪 Como Testar o Sistema de Email

## ✅ Opção 1: Usar Email Diferente (Mais Fácil)

**Não precisa apagar nada!** Use um email diferente no onboarding:

1. Complete o onboarding via WhatsApp
2. Quando pedir email, use um email **novo/diferente** (ex: `teste@email.com`)
3. O sistema vai criar usuário novo e enviar email automaticamente

## ✅ Opção 2: Apagar Conta Existente

Se quiser testar com o mesmo email:

### Via Supabase Dashboard:

1. Acesse: https://supabase.com/dashboard
2. Vá em **Authentication** → **Users**
3. Encontre seu usuário pelo email
4. Clique nos 3 pontos → **Delete user**
5. Depois complete onboarding novamente

### Via SQL (mais rápido):

```sql
-- CUIDADO: Isso apaga o usuário e todos os dados relacionados!
DELETE FROM auth.users WHERE email = 'seu-email@exemplo.com';
DELETE FROM profiles WHERE email = 'seu-email@exemplo.com';
```

## ✅ Opção 3: Endpoint de Teste (Recomendado para Dev)

Criei um endpoint de teste que força o envio de email sem criar usuário:

```bash
# Testar envio de email diretamente
curl -X POST http://localhost:8080/api/test/send-setup-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "seu-email@teste.com",
    "nome": "Seu Nome"
  }'
```

## 🔍 Verificar se Email Foi Enviado

### 1. Verificar Logs do Backend

```bash
# No Railway ou local
# Procure por: "[EMAIL] Email enviado com sucesso"
```

### 2. Verificar Logs da Edge Function

```bash
supabase functions logs enviar-email-setup
```

### 3. Verificar no Resend

1. Acesse: https://resend.com/emails
2. Veja se o email aparece na lista
3. Clique para ver detalhes

## 📧 Onde o Email Vai Chegar?

- **Caixa de entrada** (verifique spam também)
- **Resend Dashboard** → Emails (para ver status)

## ⚠️ Importante

- Email só é enviado para **usuários NOVOS**
- Se usuário já existe, apenas vincula telefone (sem email)
- Token expira em 24 horas
- Cada token só pode ser usado 1 vez

## 🐛 Se Email Não Chegar

1. **Verifique spam/lixo eletrônico**
2. **Confirme RESEND_API_KEY configurada:**
   ```bash
   supabase secrets list
   ```
3. **Veja logs da Edge Function:**
   ```bash
   supabase functions logs enviar-email-setup --follow
   ```
4. **Teste endpoint direto:**
   ```bash
   curl -X POST \
     'https://whmbyfnwnlbrfmgdwdfw.supabase.co/functions/v1/enviar-email-setup' \
     -H 'Authorization: Bearer SEU_SERVICE_ROLE_KEY' \
     -H 'Content-Type: application/json' \
     -d '{"email": "teste@email.com", "nome": "Teste"}'
   ```

