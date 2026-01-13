# Como Resolver Erro "Could not find the table 'public.profiles' in the schema cache"

## O Problema

A tabela `profiles` existe no banco de dados, mas o Supabase PostgREST (API) não consegue encontrá-la no schema cache:

```
Could not find the table 'public.profiles' in the schema cache
```

## Causa

O PostgREST mantém um cache do schema do banco. Quando uma tabela é criada ou modificada, o cache pode não atualizar imediatamente.

## Solução: Passo a Passo

### 1️⃣ Executar Script de Correção

1. Acesse o **Supabase Dashboard** → **SQL Editor**
2. Abra o arquivo: `scripts/fix-profiles-schema-cache.sql`
3. Copie todo o conteúdo e cole no SQL Editor
4. Clique em **"Run"**

Este script vai:
- ✅ Verificar se a tabela existe
- ✅ Garantir permissões corretas
- ✅ Verificar configuração de RLS
- ✅ Tentar forçar refresh do cache

### 2️⃣ Reiniciar a API do Supabase

1. No Supabase Dashboard, vá em **Settings** → **API**
2. Procure por **"Restart API"** ou **"Reload Schema"**
3. Clique para reiniciar

**Alternativa via SQL:**
```sql
NOTIFY pgrst, 'reload schema';
```

### 3️⃣ Aguardar Atualização Automática

O cache do PostgREST atualiza automaticamente a cada **2-5 minutos**. Se você acabou de criar a tabela:

- ⏳ **Aguarde 2-3 minutos**
- 🔄 **Tente novamente**

### 4️⃣ Verificar se Funcionou

Teste fazendo uma query simples no SQL Editor:

```sql
SELECT * FROM profiles LIMIT 1;
```

Se funcionar no SQL Editor mas não funcionar via API, o problema é o cache.

### 5️⃣ Verificar Permissões

Certifique-se de que a tabela tem as permissões corretas:

```sql
-- Verificar permissões
SELECT 
    grantee,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' 
AND table_name = 'profiles';

-- Se necessário, adicionar permissões
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT ALL ON TABLE public.profiles TO anon;
```

## Solução Alternativa: Usar Schema Explícito

Se o problema persistir, você pode tentar especificar o schema explicitamente no código:

```javascript
// Em vez de:
supabase.from('profiles')

// Tente:
supabase.schema('public').from('profiles')
```

**⚠️ Nota:** Isso geralmente não é necessário, mas pode funcionar como workaround temporário.

## Verificação Final

Após aplicar as soluções, teste o bot novamente:

1. Envie uma mensagem no WhatsApp
2. Verifique os logs do Railway
3. O erro `Could not find the table 'public.profiles'` deve desaparecer

## Se Nada Funcionar

1. **Verifique se a tabela realmente existe:**
   ```sql
   SELECT * FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'profiles';
   ```

2. **Verifique se está no schema correto:**
   ```sql
   SELECT schemaname, tablename 
   FROM pg_tables 
   WHERE tablename = 'profiles';
   ```

3. **Contate o suporte do Supabase** se o problema persistir após 10 minutos

---

## Resumo Rápido

1. ✅ Execute `scripts/fix-profiles-schema-cache.sql`
2. ✅ Reinicie a API do Supabase
3. ⏳ Aguarde 2-3 minutos
4. ✅ Teste novamente
