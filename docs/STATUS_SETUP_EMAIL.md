# Status do Sistema de Email Setup

## ✅ O que já está feito:

1. ✅ Migração SQL executada (`setup_tokens` table criada)
2. ✅ Edge Functions criadas:
   - `enviar-email-setup` - gera token e envia email
   - `validar-token-setup` - valida token quando usuário acessa o link
3. ✅ Backend atualizado para chamar Edge Function e incluir link na mensagem WhatsApp
4. ✅ Mensagem do WhatsApp atualizada (não mostra mais senha, mostra link)

## 🔧 O que falta fazer:

### 1. Deploy das Edge Functions no Supabase

Execute no terminal:

```bash
# 1. Login no Supabase (se ainda não fez)
supabase login

# 2. Linkar ao projeto
supabase link --project-ref whmbyfnwnlbrfmgdwdfw

# 3. Deploy das funções
supabase functions deploy enviar-email-setup
supabase functions deploy validar-token-setup

# 4. Configurar secret do Resend
supabase secrets set RESEND_API_KEY=re_Ltr1Bj3a_2wrqPbsZSWnG2gPx27qJhxW1
```

**OU** execute o script automatizado:

```bash
bash deploy-edge-functions.sh
```

### 2. Verificar se funcionou

Após o deploy, teste criando um usuário novo via WhatsApp. Você deve ver:

**No WhatsApp:**
- Mensagem de sucesso sem senha
- Link clicável: `https://lumiz-financeiro.vercel.app/setup-account?email=...&token=...`

**Nos logs do Railway:**
- `[EMAIL] Enviando email de setup para...`
- `[EMAIL] Email enviado com sucesso`

**No email:**
- Email de boas-vindas com link de setup

### 3. Ver logs das Edge Functions (se necessário)

```bash
supabase functions logs enviar-email-setup
supabase functions logs validar-token-setup
```

## 📋 Variáveis necessárias:

As Edge Functions precisam destas variáveis (já configuradas automaticamente pelo Supabase):
- `SUPABASE_URL` ✅ (automático)
- `SUPABASE_SERVICE_ROLE_KEY` ✅ (automático)
- `RESEND_API_KEY` ⚠️ (precisa configurar manualmente via `supabase secrets set`)

## 🐛 Troubleshooting:

**Se o link não aparecer no WhatsApp:**
- Verifique os logs do Railway para ver se a Edge Function foi chamada
- Verifique se as Edge Functions foram deployadas: `supabase functions list`

**Se o email não chegar:**
- Verifique os logs da Edge Function: `supabase functions logs enviar-email-setup`
- Verifique se o `RESEND_API_KEY` está configurado: `supabase secrets list`
- Verifique se o domínio do Resend está verificado (para envio de emails)

**Se o link não funcionar no frontend:**
- Verifique se o frontend está chamando a Edge Function `validar-token-setup`
- Verifique se o token está sendo passado corretamente na URL

