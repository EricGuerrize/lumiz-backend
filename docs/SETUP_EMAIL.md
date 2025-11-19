# 📧 Setup de Email com Link de Senha

## 📋 Checklist de Implementação

### 1. ✅ Criar tabela no Supabase

Execute o SQL em `docs/MIGRATION_SETUP_TOKENS.sql` no Supabase SQL Editor.

### 2. ✅ Edge Functions criadas

As funções já estão criadas em:
- `supabase/functions/enviar-email-setup/index.ts`
- `supabase/functions/validar-token-setup/index.ts`

### 3. ⏳ Deploy das Edge Functions

```bash
# Instalar Supabase CLI (se ainda não tiver)
npm install -g supabase

# Login no Supabase
supabase login

# Linkar ao projeto (se ainda não linkou)
supabase link --project-ref seu-project-ref

# Deploy das funções
supabase functions deploy enviar-email-setup
supabase functions deploy validar-token-setup
```

### 4. ⏳ Criar conta no Resend

1. Acesse: https://resend.com
2. Crie conta grátis (100 emails/dia)
3. Copie a API Key
4. Para testes, use `onboarding@resend.dev` como remetente
5. Para produção, configure seu domínio

### 5. ⏳ Adicionar secrets no Supabase

```bash
# Adicionar RESEND_API_KEY
supabase secrets set RESEND_API_KEY=sua_chave_resend_aqui
```

Ou via Dashboard do Supabase:
- Settings → Edge Functions → Secrets
- Adicione `RESEND_API_KEY` com sua chave

### 6. ✅ Código já integrado

O código já está integrado em `src/controllers/userController.js`:
- Chama `emailService.sendSetupEmail()` quando cria novo usuário
- Não bloqueia criação se email falhar

## 🧪 Como Testar

1. **Criar usuário novo via WhatsApp**
   - Complete o onboarding
   - Informe email válido
   - Verifique se email chegou

2. **Validar token**
   - Acesse: `https://lumiz-financeiro.vercel.app/setup-account?email=...&token=...`
   - O frontend deve chamar a Edge Function `validar-token-setup`
   - Token deve ser marcado como usado

3. **Configurar senha**
   - Após validar token, usuário pode criar senha
   - Fazer login normalmente

## 🔧 Configuração do Resend

### Para Testes (onboarding@resend.dev)

```env
RESEND_API_KEY=re_xxxxxxxxxxxxx
```

Remetente: `Lumiz Financeiro <onboarding@resend.dev>`

### Para Produção

1. Adicione seu domínio no Resend
2. Configure DNS (SPF, DKIM, DMARC)
3. Use: `Lumiz Financeiro <noreply@seudominio.com>`

## 📝 Estrutura

```
supabase/functions/
├── enviar-email-setup/
│   └── index.ts          # Gera token e envia email
└── validar-token-setup/
    └── index.ts          # Valida token e marca como usado

src/services/
└── emailService.js       # Wrapper para chamar Edge Functions

src/controllers/
└── userController.js     # Chama emailService ao criar usuário
```

## ⚠️ Importante

- Token expira em 24 horas
- Token só pode ser usado 1 vez
- Email não bloqueia criação de usuário (fail-safe)
- Use Resend para testes ou produção
- Configure domínio próprio para produção

## 🐛 Troubleshooting

### Email não chega
- Verifique spam/lixo eletrônico
- Confirme RESEND_API_KEY está configurada
- Verifique logs da Edge Function no Supabase Dashboard

### Token inválido
- Verifique se token não expirou (24h)
- Confirme que token não foi usado antes
- Verifique email e token na URL

### Edge Function não funciona
- Verifique se fez deploy: `supabase functions deploy`
- Confirme secrets configurados
- Veja logs: `supabase functions logs enviar-email-setup`

