# Como Aplicar as Migrations de Segurança

## ✅ Opção 1: Via Supabase Dashboard (Mais Fácil)

1. **Acesse o Supabase Dashboard:**
   - Vá para: https://supabase.com/dashboard/project/whmbyfnwnlbrfmgdwdfw
   - Ou acesse seu projeto no dashboard

2. **Abra o SQL Editor:**
   - No menu lateral, clique em **SQL Editor**
   - Clique em **New query**

3. **Execute o script:**
   - Abra o arquivo: `scripts/apply-new-migrations.sql`
   - Copie TODO o conteúdo
   - Cole no SQL Editor
   - Clique em **Run** (ou pressione Cmd/Ctrl + Enter)

4. **Verifique o resultado:**
   - Deve aparecer mensagens de sucesso
   - Se houver erros, verifique se as tabelas existem

---

## ✅ Opção 2: Via Supabase CLI (Se tiver acesso)

```bash
# No diretório do projeto
cd /Users/ericguerrize/lumiz-backend

# Aplicar migrations (vai pedir confirmação)
supabase db push

# Ou aplicar apenas as novas:
supabase migration up
```

**Nota:** Pode pedir senha do banco. Você pode encontrar no Dashboard:
- Settings → Database → Database password

---

## ✅ Opção 3: Executar SQL Diretamente

Se preferir executar as migrations uma por uma:

### Migration 1: RLS Security
```bash
# Execute o conteúdo de:
supabase/migrations/20251216000000_enable_rls_security.sql
```

### Migration 2: SQL Functions
```bash
# Execute o conteúdo de:
supabase/migrations/20251216000001_fix_sql_functions_security.sql
```

---

## 🔍 Como Verificar se Funcionou

Após aplicar, execute no SQL Editor:

```sql
-- Verificar se RLS está habilitado
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('onboarding_progress', 'mdr_configs', 'ocr_jobs', 'setup_tokens');

-- Deve retornar rowsecurity = true para todas

-- Verificar policies criadas
SELECT tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename IN ('onboarding_progress', 'mdr_configs', 'ocr_jobs', 'setup_tokens');

-- Deve retornar várias policies (select, insert, update para cada tabela)

-- Verificar funções com search_path
SELECT proname, prosecdef, proconfig 
FROM pg_proc 
WHERE proname IN ('limpar_tokens_expirados', 'update_updated_at_column');

-- proconfig deve conter 'search_path=public'
```

---

## ⚠️ Importante

- **Backup:** As migrations são seguras (não deletam dados), mas sempre bom ter backup
- **Teste:** Após aplicar, teste se os endpoints ainda funcionam
- **Service Role:** O service role ainda pode acessar tudo (para operações backend)

---

## 🆘 Problemas Comuns

### Erro: "relation already exists"
- Normal, significa que a policy/função já existe
- O script usa `IF NOT EXISTS` para evitar isso

### Erro: "permission denied"
- Verifique se está usando a service role key ou tem permissões adequadas

### Erro: "column does not exist"
- Verifique se a tabela `profiles` tem a coluna `telefone`
- Se não tiver, pode precisar ajustar as policies

