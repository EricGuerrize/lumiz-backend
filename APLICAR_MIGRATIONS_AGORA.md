# 🚀 Aplicar Migrations - Instruções Rápidas

## ⚡ Método Mais Rápido (2 minutos)

1. **Abra este link:**
   https://supabase.com/dashboard/project/whmbyfnwnlbrfmgdwdfw/sql/new

2. **Abra o arquivo no seu editor:**
   `scripts/apply-new-migrations.sql`

3. **Copie TODO o conteúdo** (Cmd/Ctrl + A, Cmd/Ctrl + C)

4. **Cole no SQL Editor** do Supabase

5. **Clique em "Run"** (ou Cmd/Ctrl + Enter)

6. **Pronto!** ✅

---

## 📋 O Que Será Aplicado

- ✅ RLS habilitado em 4 tabelas sensíveis
- ✅ Policies criadas para segurança
- ✅ Funções SQL corrigidas com `SET search_path`

---

## ⚠️ Nota

Há um problema com uma migration anterior (`20251208_create_user_insights.sql`) que usa `uuid_generate_v4()` sem a extensão habilitada. 

**Solução:** As novas migrations de segurança são independentes e podem ser aplicadas diretamente. O problema da migration anterior não afeta a aplicação das novas.

---

## 🔍 Verificar se Funcionou

Após aplicar, execute no SQL Editor:

```sql
-- Verificar RLS
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('onboarding_progress', 'mdr_configs', 'ocr_jobs', 'setup_tokens');
```

Todas devem retornar `rowsecurity = true`.

