#!/bin/bash

# Script para fazer deploy das Edge Functions do Supabase
# Execute: bash deploy-edge-functions.sh

echo "🚀 Deploy das Edge Functions - Lumiz"
echo ""

# Verifica se está logado
echo "📋 Verificando login no Supabase..."
if ! supabase projects list &>/dev/null; then
    echo "❌ Não está logado. Fazendo login..."
    supabase login
fi

# Project Reference (do seu .env ou dashboard)
PROJECT_REF="whmbyfnwnlbrfmgdwdfw"
RESEND_API_KEY="re_Ltr1Bj3a_2wrqPbsZSWnG2gPx27qJhxW1"

echo "🔗 Linkando ao projeto: $PROJECT_REF"
supabase link --project-ref $PROJECT_REF

echo ""
echo "📦 Fazendo deploy das funções..."

echo "  → Deploy enviar-email-setup..."
supabase functions deploy enviar-email-setup

echo "  → Deploy validar-token-setup..."
supabase functions deploy validar-token-setup

echo ""
echo "🔐 Configurando secrets..."
supabase secrets set RESEND_API_KEY=$RESEND_API_KEY

echo ""
echo "✅ Deploy concluído!"
echo ""
echo "📝 Próximos passos:"
echo "  1. Execute a migração SQL: docs/MIGRATION_SETUP_TOKENS.sql"
echo "  2. Teste criando um usuário novo via WhatsApp"
echo "  3. Verifique se o email chegou"
echo ""
echo "🧪 Para ver logs:"
echo "  supabase functions logs enviar-email-setup"
echo "  supabase functions logs validar-token-setup"

