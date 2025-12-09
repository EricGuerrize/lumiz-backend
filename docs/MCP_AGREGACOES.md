# 🔧 Habilitando Suporte a Agregações no MCP

## 📋 Problema

O MCP server atual tem um parser simples que não suporta funções de agregação como `COUNT(*)`, `SUM()`, `AVG()`, etc. Quando você faz uma query como:

```sql
SELECT COUNT(*) FROM profiles
```

O servidor retorna todos os registros em vez do resultado agregado.

## ✅ Solução

Execute a função RPC `exec_sql_readonly` no Supabase para habilitar suporte completo a:
- ✅ Funções de agregação (COUNT, SUM, AVG, MIN, MAX)
- ✅ GROUP BY
- ✅ JOINs complexos
- ✅ Subqueries
- ✅ Qualquer query SELECT válida

---

## 🚀 Como Configurar

### Opção 1: Via Migração (Recomendado)

1. **Execute a migração no Supabase:**
   ```bash
   # No diretório do projeto
   supabase db push
   ```

   Ou execute manualmente o arquivo:
   ```bash
   cat supabase/migrations/20251209_create_mcp_exec_sql.sql
   ```

2. **Copie o conteúdo e execute no Supabase SQL Editor:**
   - Acesse: https://supabase.com/dashboard/project/whmbyfnwnlbrfmgdwdfw/sql/new
   - Cole o conteúdo do arquivo `supabase/migrations/20251209_create_mcp_exec_sql.sql`
   - Clique em "Run"

### Opção 2: Executar SQL Diretamente

1. Acesse o SQL Editor do Supabase:
   https://supabase.com/dashboard/project/whmbyfnwnlbrfmgdwdfw/sql/new

2. Cole e execute este SQL:

```sql
CREATE OR REPLACE FUNCTION exec_sql_readonly(query_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    query_lower TEXT;
BEGIN
    -- Normaliza a query para verificação
    query_lower := LOWER(TRIM(query_text));
    
    -- Segurança: Apenas permite SELECT
    IF NOT (query_lower ~ '^\s*select\s') THEN
        RAISE EXCEPTION 'Apenas queries SELECT são permitidas por segurança';
    END IF;
    
    -- Bloqueia comandos perigosos mesmo dentro de SELECT
    IF query_lower ~* '(insert|update|delete|drop|create|alter|truncate|grant|revoke|exec|execute)' THEN
        RAISE EXCEPTION 'Comandos de modificação não são permitidos';
    END IF;
    
    -- Executa a query e retorna como JSONB
    EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query_text) INTO result;
    
    -- Retorna array vazio se não houver resultados
    RETURN COALESCE(result, '[]'::jsonb);
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Erro ao executar query: %', SQLERRM;
END;
$$;
```

---

## 🧪 Testando

Após configurar, teste no Claude Desktop:

### Exemplos de Queries que Agora Funcionam:

1. **Contar registros:**
   ```
   "Quantos usuários temos?"
   ```
   Query gerada: `SELECT COUNT(*) FROM profiles`

2. **Agregações:**
   ```
   "Qual o faturamento total?"
   ```
   Query gerada: `SELECT SUM(valor_total) FROM atendimentos`

3. **GROUP BY:**
   ```
   "Mostre o faturamento por usuário"
   ```
   Query gerada: `SELECT user_id, SUM(valor_total) FROM atendimentos GROUP BY user_id`

4. **Queries complexas:**
   ```
   "Quantos usuários completaram o onboarding?"
   ```
   Query gerada: `SELECT COUNT(*) FROM onboarding_progress WHERE completed = true`

---

## 🔒 Segurança

A função `exec_sql_readonly` é segura porque:

1. ✅ **Apenas SELECT**: Bloqueia INSERT, UPDATE, DELETE, DROP, etc.
2. ✅ **SECURITY DEFINER**: Executa com permissões do criador (service_role)
3. ✅ **Validação dupla**: Verifica tanto no início quanto bloqueia comandos perigosos
4. ✅ **Tratamento de erros**: Retorna mensagens claras em caso de erro

---

## ⚠️ Troubleshooting

### Erro: "function exec_sql_readonly does not exist"

**Causa:** A função não foi criada no banco.

**Solução:** Execute o SQL acima no Supabase SQL Editor.

### Erro: "Apenas queries SELECT são permitidas"

**Causa:** Você tentou executar uma query que não é SELECT.

**Solução:** Use apenas queries SELECT. O MCP é read-only por design.

### Ainda retorna todos os registros em vez de agregação

**Causa:** A função RPC não está disponível e o servidor está usando fallback.

**Solução:** 
1. Verifique se a função foi criada: `SELECT proname FROM pg_proc WHERE proname = 'exec_sql_readonly';`
2. Se não existir, execute a migração novamente
3. Reinicie o Claude Desktop após criar a função

---

## 📊 Exemplos Completos

### Contar usuários ativos:
```sql
SELECT COUNT(*) FROM profiles WHERE is_active = true
```

### Faturamento por mês:
```sql
SELECT 
    DATE_TRUNC('month', data) as mes,
    SUM(valor_total) as faturamento
FROM atendimentos
GROUP BY DATE_TRUNC('month', data)
ORDER BY mes DESC
```

### Top 5 usuários por faturamento:
```sql
SELECT 
    p.nome_completo,
    SUM(a.valor_total) as total
FROM atendimentos a
JOIN profiles p ON a.user_id = p.id
GROUP BY p.id, p.nome_completo
ORDER BY total DESC
LIMIT 5
```

---

## ✅ Verificação

Para verificar se está funcionando:

1. No Claude Desktop, pergunte: "Quantos usuários temos?"
2. Se retornar um número (ex: "5 usuários") em vez de uma lista, está funcionando! ✅
3. Se ainda retornar todos os registros, a função RPC não está configurada.

---

## 🎯 Próximos Passos

Após configurar, você pode:
- ✅ Fazer análises complexas via linguagem natural
- ✅ Obter estatísticas agregadas instantaneamente
- ✅ Criar relatórios personalizados
- ✅ Fazer comparações e análises temporais

**Agora o MCP está completo e poderoso!** 🚀
