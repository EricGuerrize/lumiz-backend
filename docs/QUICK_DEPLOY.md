# ⚡ Deploy Rápido - Edge Functions

## 🎯 Você já tem tudo pronto!

- ✅ Supabase CLI instalado
- ✅ API Key do Resend: `re_Ltr1Bj3a_2wrqPbsZSWnG2gPx27qJhxW1`
- ✅ Edge Functions criadas

## 🚀 Opção 1: Script Automático (Recomendado)

Execute no terminal do Cursor:

```bash
bash deploy-edge-functions.sh
```

O script vai:
1. Fazer login (se necessário)
2. Linkar ao projeto
3. Fazer deploy das funções
4. Configurar a API key do Resend

## 🚀 Opção 2: Manual (Passo a Passo)

### 1. Login no Supabase

```bash
supabase login
```

### 2. Linkar ao Projeto

```bash
supabase link --project-ref whmbyfnwnlbrfmgdwdfw
```

### 3. Deploy das Funções

```bash
supabase functions deploy enviar-email-setup
supabase functions deploy validar-token-setup
```

### 4. Configurar API Key do Resend

```bash
supabase secrets set RESEND_API_KEY=re_Ltr1Bj3a_2wrqPbsZSWnG2gPx27qJhxW1
```

## ✅ Depois do Deploy

### 1. Executar Migração SQL

Execute no Supabase SQL Editor:
- Arquivo: `docs/MIGRATION_SETUP_TOKENS.sql`

### 2. Testar

1. Crie um usuário novo via WhatsApp
2. Verifique se email chegou
3. Clique no link e configure senha

## 🐛 Se der erro

### "Not linked to a project"
```bash
supabase link --project-ref whmbyfnwnlbrfmgdwdfw
```

### "Function not found"
```bash
# Verifique se está no diretório correto
cd /Users/ericguerrize/lumiz-backend

# Deploy novamente
supabase functions deploy enviar-email-setup
```

### Ver logs
```bash
supabase functions logs enviar-email-setup
supabase functions logs validar-token-setup
```

## 📝 Checklist Final

- [ ] Executar migração SQL (`MIGRATION_SETUP_TOKENS.sql`)
- [ ] Fazer deploy das Edge Functions
- [ ] Configurar RESEND_API_KEY
- [ ] Testar criando usuário novo
- [ ] Verificar se email chegou

