# 🔧 Correções: Dashboard e Detecção de Cadastro

## Problema 1: Dashboard com Erros 403/401

### Causa
As tabelas têm RLS (Row Level Security) habilitado, mas **faltam políticas** para várias tabelas que o dashboard precisa acessar.

### Tabelas que precisam de políticas RLS:
- `profiles`
- `atendimentos`
- `contas_pagar`
- `clientes`
- `procedimentos`
- `agendamentos`
- `atendimento_procedimentos`
- `user_roles`
- `orcamentos` (se existir)

### Solução: Criar políticas RLS

Execute no **SQL Editor do Supabase**:

```sql
-- ========================================
-- POLÍTICAS RLS PARA DASHBOARD
-- ========================================

-- 1. PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_own_profile ON public.profiles;
CREATE POLICY users_select_own_profile
  ON public.profiles
  FOR SELECT
  USING (id = auth.uid());

DROP POLICY IF EXISTS users_update_own_profile ON public.profiles;
CREATE POLICY users_update_own_profile
  ON public.profiles
  FOR UPDATE
  USING (id = auth.uid());

-- 2. ATENDIMENTOS
ALTER TABLE public.atendimentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_own_atendimentos ON public.atendimentos;
CREATE POLICY users_select_own_atendimentos
  ON public.atendimentos
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS users_insert_own_atendimentos ON public.atendimentos;
CREATE POLICY users_insert_own_atendimentos
  ON public.atendimentos
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS users_update_own_atendimentos ON public.atendimentos;
CREATE POLICY users_update_own_atendimentos
  ON public.atendimentos
  FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS users_delete_own_atendimentos ON public.atendimentos;
CREATE POLICY users_delete_own_atendimentos
  ON public.atendimentos
  FOR DELETE
  USING (user_id = auth.uid());

-- 3. CONTAS_PAGAR
ALTER TABLE public.contas_pagar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_own_contas_pagar ON public.contas_pagar;
CREATE POLICY users_select_own_contas_pagar
  ON public.contas_pagar
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS users_insert_own_contas_pagar ON public.contas_pagar;
CREATE POLICY users_insert_own_contas_pagar
  ON public.contas_pagar
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS users_update_own_contas_pagar ON public.contas_pagar;
CREATE POLICY users_update_own_contas_pagar
  ON public.contas_pagar
  FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS users_delete_own_contas_pagar ON public.contas_pagar;
CREATE POLICY users_delete_own_contas_pagar
  ON public.contas_pagar
  FOR DELETE
  USING (user_id = auth.uid());

-- 4. CLIENTES
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_own_clientes ON public.clientes;
CREATE POLICY users_select_own_clientes
  ON public.clientes
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS users_insert_own_clientes ON public.clientes;
CREATE POLICY users_insert_own_clientes
  ON public.clientes
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS users_update_own_clientes ON public.clientes;
CREATE POLICY users_update_own_clientes
  ON public.clientes
  FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS users_delete_own_clientes ON public.clientes;
CREATE POLICY users_delete_own_clientes
  ON public.clientes
  FOR DELETE
  USING (user_id = auth.uid());

-- 5. PROCEDIMENTOS
ALTER TABLE public.procedimentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_own_procedimentos ON public.procedimentos;
CREATE POLICY users_select_own_procedimentos
  ON public.procedimentos
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS users_insert_own_procedimentos ON public.procedimentos;
CREATE POLICY users_insert_own_procedimentos
  ON public.procedimentos
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS users_update_own_procedimentos ON public.procedimentos;
CREATE POLICY users_update_own_procedimentos
  ON public.procedimentos
  FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS users_delete_own_procedimentos ON public.procedimentos;
CREATE POLICY users_delete_own_procedimentos
  ON public.procedimentos
  FOR DELETE
  USING (user_id = auth.uid());

-- 6. AGENDAMENTOS
ALTER TABLE public.agendamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_own_agendamentos ON public.agendamentos;
CREATE POLICY users_select_own_agendamentos
  ON public.agendamentos
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS users_insert_own_agendamentos ON public.agendamentos;
CREATE POLICY users_insert_own_agendamentos
  ON public.agendamentos
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS users_update_own_agendamentos ON public.agendamentos;
CREATE POLICY users_update_own_agendamentos
  ON public.agendamentos
  FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS users_delete_own_agendamentos ON public.agendamentos;
CREATE POLICY users_delete_own_agendamentos
  ON public.agendamentos
  FOR DELETE
  USING (user_id = auth.uid());

-- 7. ATENDIMENTO_PROCEDIMENTOS
ALTER TABLE public.atendimento_procedimentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_own_atendimento_procedimentos ON public.atendimento_procedimentos;
CREATE POLICY users_select_own_atendimento_procedimentos
  ON public.atendimento_procedimentos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.atendimentos
      WHERE atendimentos.id = atendimento_procedimentos.atendimento_id
      AND atendimentos.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS users_insert_own_atendimento_procedimentos ON public.atendimento_procedimentos;
CREATE POLICY users_insert_own_atendimento_procedimentos
  ON public.atendimento_procedimentos
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.atendimentos
      WHERE atendimentos.id = atendimento_procedimentos.atendimento_id
      AND atendimentos.user_id = auth.uid()
    )
  );

-- 8. USER_ROLES
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_own_roles ON public.user_roles;
CREATE POLICY users_select_own_roles
  ON public.user_roles
  FOR SELECT
  USING (user_id = auth.uid());
```

---

## Problema 2: Bot Não Detecta Cadastro

### Causa
Após cadastro no dashboard, o bot não reconhece o usuário porque:
1. **Formato do telefone pode ser diferente** (com/sem código do país)
2. **Cache em memória** pode ainda ter estado antigo
3. **Busca não está normalizando** o telefone

### Solução: Normalizar telefone na busca

Vou atualizar o `findUserByPhone` para buscar em ambos os formatos.

---

## Próximos Passos

1. ✅ Execute o SQL acima no Supabase
2. ✅ Atualizar `findUserByPhone` para normalizar telefone
3. ✅ Testar dashboard após aplicar políticas
4. ✅ Testar bot após cadastro

