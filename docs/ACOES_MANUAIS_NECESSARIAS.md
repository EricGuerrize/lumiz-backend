# ⚠️ Ações Manuais Necessárias

**Data:** 16/12/2025

Após a implementação dos to-dos, você precisa executar as seguintes ações:

---

## ✅ 1. Aplicar Migrations no Supabase (OBRIGATÓRIO)

As migrations criadas precisam ser aplicadas no banco de dados:

### Opção A: Via Supabase CLI (Recomendado)
```bash
# Se você usa Supabase CLI local
supabase migration up

# Ou se você usa Supabase Cloud
supabase db push
```

### Opção B: Via Supabase Dashboard
1. Acesse o Supabase Dashboard do seu projeto
2. Vá em **SQL Editor**
3. Execute manualmente os arquivos:
   - `supabase/migrations/20251216000000_enable_rls_security.sql`
   - `supabase/migrations/20251216000001_fix_sql_functions_security.sql`

**⚠️ IMPORTANTE:** Sem aplicar essas migrations, o RLS não estará habilitado e as funções SQL continuarão vulneráveis.

---

## ✅ 2. Instalar Jest (OPCIONAL - só se quiser rodar testes unitários)

Jest foi adicionado ao `package.json`, mas precisa ser instalado:

```bash
npm install
```

Ou apenas Jest:
```bash
npm install --save-dev jest
```

**Nota:** Se você não vai rodar testes unitários agora, pode pular este passo.

---

## ✅ 3. Configurar Redis (OPCIONAL - mas recomendado para performance)

O cache e as filas funcionam sem Redis (com fallback), mas para melhor performance:

### Opção A: Usar Docker Compose (Local)
```bash
# Já existe docker-compose.yml no projeto
docker-compose up -d redis
```

Depois adicione ao seu `.env`:
```env
REDIS_URL=redis://localhost:6379
```

### Opção B: Redis Cloud (Produção)
1. Crie uma conta no [Redis Cloud](https://redis.com/try-free/) ou use outro provedor
2. Adicione a URL ao `.env`:
```env
REDIS_URL=redis://usuario:senha@host:porta
```

### Opção C: Sem Redis (Funciona, mas sem cache/filas)
- O sistema funciona normalmente
- Cache será desabilitado automaticamente
- Filas usarão processamento síncrono (fallback)

---

## ✅ 4. Verificar Variáveis de Ambiente

Certifique-se de que seu `.env` tem as variáveis necessárias:

```env
# Supabase (já deve estar configurado)
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

# Redis (opcional, mas recomendado)
REDIS_URL=redis://localhost:6379

# Outras variáveis existentes...
```

---

## ✅ 5. Testar as Implementações

### Testar RLS (Row Level Security)
```bash
# Após aplicar migrations, teste se as policies funcionam
# Tente acessar dados de outro usuário - deve ser bloqueado
```

### Testar Validação
```bash
# Faça uma requisição com dados inválidos
curl -X POST http://localhost:3000/api/onboarding/steps \
  -H "Content-Type: application/json" \
  -d '{"stepId": ""}'  # stepId vazio deve retornar erro 400
```

### Testar Cache
```bash
# Verifique os logs ao iniciar o servidor
# Deve aparecer: [CACHE] ✅ Redis conectado (se Redis configurado)
# Ou: [CACHE] ⚠️ REDIS_URL não configurada. Cache desabilitado.
```

### Testar Filas
```bash
# Verifique os logs ao iniciar o servidor
# Deve aparecer: [MDR_QUEUE] ✅ BullMQ iniciado com sucesso!
# E: [PDF_QUEUE] ✅ BullMQ iniciado com sucesso!
```

---

## 📋 Checklist Rápido

- [ ] Aplicar migrations no Supabase (OBRIGATÓRIO)
- [ ] Instalar Jest: `npm install` (OPCIONAL)
- [ ] Configurar Redis no `.env` (OPCIONAL, mas recomendado)
- [ ] Verificar logs ao iniciar servidor
- [ ] Testar validação com dados inválidos
- [ ] Testar acesso a dados (RLS deve bloquear acesso não autorizado)

---

## 🚨 O Que Pode Quebrar Se Não Fizer

### Se não aplicar migrations:
- ❌ RLS não estará habilitado (vulnerabilidade de segurança)
- ❌ Funções SQL continuarão vulneráveis a search_path injection
- ⚠️ Dados sensíveis acessíveis sem autenticação adequada

### Se não configurar Redis:
- ✅ Sistema funciona normalmente
- ⚠️ Sem cache (mais queries ao banco)
- ⚠️ Processamento síncrono (pode ser mais lento)

### Se não instalar Jest:
- ✅ Sistema funciona normalmente
- ❌ Não poderá rodar testes unitários (`npm run test:unit`)

---

## 💡 Dica

A ação **mais importante** é aplicar as migrations no Supabase. As outras são opcionais mas recomendadas para melhor performance e segurança.
