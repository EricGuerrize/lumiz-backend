# 🚀 Deploy das Edge Functions - Passo a Passo

## ✅ Pré-requisitos

- Supabase CLI já instalado (✅ confirmado)
- Conta no Resend criada
- API Key do Resend copiada

## 📋 Passo a Passo

### 1. Login no Supabase

```bash
supabase login
```

Isso vai abrir o navegador para você fazer login.

### 2. Linkar ao Projeto

Você precisa do **Project Reference** do seu projeto Supabase:

1. Acesse: https://supabase.com/dashboard
2. Selecione seu projeto
3. Vá em **Settings** → **General**
4. Copie o **Reference ID** (algo como: `whmbyfnwnlbrfmgdwdfw`)

Depois execute:

```bash
supabase link --project-ref SEU_PROJECT_REF_AQUI
```

**Exemplo:**
```bash
supabase link --project-ref whmbyfnwnlbrfmgdwdfw
```

### 3. Deploy das Funções

```bash
# Deploy da função de enviar email
supabase functions deploy enviar-email-setup

# Deploy da função de validar token
supabase functions deploy validar-token-setup
```

### 4. Configurar Secrets (API Keys)

```bash
# Adicionar RESEND_API_KEY
supabase secrets set RESEND_API_KEY=sua_chave_resend_aqui
```

**Onde pegar a chave:**
1. Acesse: https://resend.com/api-keys
2. Copie sua API Key
3. Cole no comando acima

### 5. Verificar Deploy

```bash
# Listar funções deployadas
supabase functions list

# Ver logs (útil para debug)
supabase functions logs enviar-email-setup
supabase functions logs validar-token-setup
```

## 🧪 Testar

### Testar Enviar Email

```bash
curl -X POST \
  'https://SEU_PROJECT_REF.supabase.co/functions/v1/enviar-email-setup' \
  -H 'Authorization: Bearer SEU_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "seu-email@teste.com",
    "nome": "Teste"
  }'
```

### Testar Validar Token

```bash
curl -X POST \
  'https://SEU_PROJECT_REF.supabase.co/functions/v1/validar-token-setup' \
  -H 'Authorization: Bearer SEU_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "seu-email@teste.com",
    "token": "token-gerado-no-email"
  }'
```

## 🔧 Alternativa: Via Dashboard do Supabase

Se preferir não usar CLI, você pode:

1. **Acessar Dashboard**: https://supabase.com/dashboard
2. **Ir em**: Edge Functions
3. **Criar função manualmente** e colar o código
4. **Configurar secrets** em Settings → Edge Functions → Secrets

## ⚠️ Importante

- **RESEND_API_KEY** deve ser configurada como secret
- Para testes, use `onboarding@resend.dev` como remetente
- Para produção, configure seu domínio no Resend
- Tokens expiram em 24 horas
- Cada token só pode ser usado 1 vez

## 🐛 Troubleshooting

### Erro: "Not linked to a project"
```bash
# Execute novamente:
supabase link --project-ref SEU_PROJECT_REF
```

### Erro: "Function not found"
```bash
# Verifique se está no diretório correto:
cd /Users/ericguerrize/lumiz-backend

# Deploy novamente:
supabase functions deploy enviar-email-setup
```

### Email não chega
- Verifique spam
- Confirme RESEND_API_KEY está configurada
- Veja logs: `supabase functions logs enviar-email-setup`

## 📝 Comandos Úteis

```bash
# Ver status do projeto
supabase status

# Ver todas as funções
supabase functions list

# Ver logs em tempo real
supabase functions logs enviar-email-setup --follow

# Deletar função (se precisar)
supabase functions delete enviar-email-setup
```

