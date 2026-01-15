# 📋 Instruções para Aplicar o Sistema de Múltiplos Números

## ✅ O que já foi feito automaticamente

- ✅ Código implementado (services, controllers, handlers)
- ✅ Migration SQL criada
- ✅ Mensagens de copy adicionadas
- ✅ Documentação atualizada

## 🔧 O que você precisa fazer manualmente

### 1. Aplicar a Migration no Supabase

**Opção A: Via Supabase Dashboard (Recomendado)**

1. Acesse o Supabase Dashboard do seu projeto
2. Vá em **SQL Editor** (menu lateral)
3. Clique em **New Query**
4. Abra o arquivo: `supabase/migrations/20260114000000_create_clinic_members.sql`
5. **Copie TODO o conteúdo** do arquivo
6. Cole no SQL Editor do Supabase
7. Clique em **Run** (ou pressione `Ctrl+Enter` / `Cmd+Enter`)

**Opção B: Via Supabase CLI (se tiver configurado)**

```bash
cd /Users/ericguerrize/lumiz-backend
supabase migration up
```

### 2. Verificar se a Migration foi Aplicada

Execute esta query no SQL Editor do Supabase para verificar:

```sql
-- Verifica se a tabela foi criada
SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'clinic_members'
ORDER BY ordinal_position;
```

Você deve ver as colunas: `id`, `clinic_id`, `telefone`, `nome`, `funcao`, `is_primary`, `is_active`, `confirmed`, `confirmed_at`, `created_by`, `created_at`, `updated_at`

### 3. Reiniciar o Servidor (se estiver rodando)

Se o servidor Node.js estiver rodando (local ou Railway), **reinicie** para carregar os novos arquivos:

**Local:**
```bash
# Pare o servidor (Ctrl+C) e inicie novamente
npm start
# ou
node src/server.js
```

**Railway:**
- Faça commit e push das mudanças
- Railway vai fazer deploy automaticamente
- Ou force um redeploy no dashboard

### 4. Testar o Sistema

Após aplicar a migration e reiniciar:

1. **Teste o onboarding:**
   - Inicie um novo onboarding
   - Quando perguntar sobre função, escolha uma opção
   - Deve aparecer a pergunta: "Deseja cadastrar algum outro número?"
   - Teste adicionar um número adicional

2. **Teste adicionar número após onboarding:**
   - Com um usuário já cadastrado, envie: "cadastrar número"
   - Deve iniciar o fluxo de cadastro

3. **Teste listar números:**
   - Envie: "números cadastrados" ou "listar números"
   - Deve mostrar os números vinculados à clínica

## ⚠️ Possíveis Problemas

### Erro: "relation clinic_members already exists"
- Significa que a tabela já existe
- Pode ignorar ou usar `DROP TABLE IF EXISTS clinic_members CASCADE;` antes de criar

### Erro nas RLS Policies
- Verifique se a função `current_setting('app.current_phone', true)` está sendo usada corretamente
- Se necessário, ajuste as policies conforme sua configuração de autenticação

### Erro: "function update_clinic_members_updated_at() already exists"
- A função já existe, pode ignorar
- O `CREATE OR REPLACE` deve resolver automaticamente

## 📝 Checklist Final

- [ ] Migration aplicada no Supabase
- [ ] Tabela `clinic_members` criada e verificada
- [ ] Servidor reiniciado
- [ ] Teste de onboarding com múltiplos números funcionando
- [ ] Teste de adicionar número após onboarding funcionando
- [ ] Teste de listar números funcionando

## 🎉 Pronto!

Após completar esses passos, o sistema de múltiplos números WhatsApp por clínica estará totalmente funcional!
