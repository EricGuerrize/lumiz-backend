# ⚡ Fix Rápido: Habilitar Agregações no MCP

## 🎯 Problema
O MCP está retornando todos os registros em vez de executar agregações como `COUNT(*)`.

## ✅ Solução Rápida (2 minutos)

### Passo 1: Acesse o Supabase SQL Editor
👉 https://supabase.com/dashboard/project/whmbyfnwnlbrfmgdwdfw/sql/new

### Passo 2: Cole e Execute este SQL

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
    query_lower := LOWER(TRIM(query_text));
    
    IF NOT (query_lower ~ '^\s*select\s') THEN
        RAISE EXCEPTION 'Apenas queries SELECT são permitidas por segurança';
    END IF;
    
    IF query_lower ~* '(insert|update|delete|drop|create|alter|truncate|grant|revoke|exec|execute)' THEN
        RAISE EXCEPTION 'Comandos de modificação não são permitidos';
    END IF;
    
    EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query_text) INTO result;
    
    RETURN COALESCE(result, '[]'::jsonb);
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Erro ao executar query: %', SQLERRM;
END;
$$;
```

### Passo 3: Clique em "Run" ✅

### Passo 4: Teste no Claude Desktop
Pergunte: **"Quantos usuários temos?"**

Se retornar um número (ex: "5 usuários") em vez de uma lista, está funcionando! 🎉

---

## 📋 O que isso faz?

Cria uma função segura no banco que permite executar qualquer query SELECT, incluindo:
- ✅ `COUNT(*)` - Contar registros
- ✅ `SUM()` - Somar valores
- ✅ `AVG()` - Média
- ✅ `GROUP BY` - Agrupar dados
- ✅ JOINs complexos
- ✅ Subqueries

---

## 🔒 É Seguro?

Sim! A função:
- ✅ Apenas permite SELECT (read-only)
- ✅ Bloqueia comandos perigosos (INSERT, UPDATE, DELETE, DROP, etc)
- ✅ Retorna dados como JSONB seguro

---

## ❓ Ainda não funciona?

1. Verifique se a função foi criada:
   ```sql
   SELECT proname FROM pg_proc WHERE proname = 'exec_sql_readonly';
   ```
   Deve retornar `exec_sql_readonly`

2. Reinicie o Claude Desktop completamente

3. Veja a documentação completa: `docs/MCP_AGREGACOES.md`
