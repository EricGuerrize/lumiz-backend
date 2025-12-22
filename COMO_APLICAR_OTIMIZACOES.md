# 🚀 Como Aplicar as Otimizações Críticas

## ✅ O que já foi feito (automático)

- ✅ Código de heurística criado (`intentHeuristicService.js`)
- ✅ `messageController.js` modificado para usar heurística
- ✅ `userController.js` modificado para usar UPSERT
- ✅ Migration criada para constraints UNIQUE

---

## 📋 O que VOCÊ precisa fazer

### 1. Aplicar a Migration no Banco de Dados

**Opção A: Via Supabase Dashboard (Recomendado)**

1. Acesse o Supabase Dashboard do seu projeto
2. Vá em **SQL Editor**
3. Abra o arquivo: `supabase/migrations/20251217000000_add_unique_constraints_upsert.sql`
4. Copie todo o conteúdo SQL
5. Cole no SQL Editor e execute

**Opção B: Via Supabase CLI**

```bash
cd /Users/ericguerrize/lumiz-backend
supabase migration up
```

**Opção C: Via Script Node**

```bash
cd /Users/ericguerrize/lumiz-backend
node scripts/apply-migrations.js
```

**⚠️ IMPORTANTE:** A migration é idempotente (pode rodar múltiplas vezes sem problemas).

---

### 2. Verificar se a Migration Funcionou

Execute no SQL Editor do Supabase:

```sql
-- Verificar constraint em clientes
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'clientes'::regclass 
AND conname = 'clientes_user_id_nome_unique';

-- Verificar constraint em procedimentos
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'procedimentos'::regclass 
AND conname = 'procedimentos_user_id_nome_unique';
```

**Resultado esperado:** Deve retornar 1 linha para cada constraint (tipo 'u' = UNIQUE).

---

### 3. Testar Localmente (Opcional mas Recomendado)

**Teste 1: Heurística**

Envie mensagens de teste no WhatsApp:
- "Botox 2800" → Deve usar heurística (ver log: `source: heuristic`)
- "Insumos 500" → Deve usar heurística
- "Saldo" → Deve usar heurística
- "Mensagem muito complexa e ambígua que não faz sentido" → Deve chamar Gemini

**Teste 2: UPSERT**

Crie uma transação e verifique nos logs:
- Primeira vez: deve criar cliente/procedimento
- Segunda vez: deve reutilizar (não duplicar)

---

### 4. Deploy para Produção

**Se usar Railway/Heroku/Vercel:**

```bash
git add .
git commit -m "feat: otimizações críticas - heurística + UPSERT"
git push origin main
```

O deploy automático vai aplicar as mudanças.

**Se usar deploy manual:**

1. Faça backup do banco de dados
2. Aplique a migration (passo 1)
3. Faça deploy do código:
   ```bash
   npm install  # se houver novas dependências
   pm2 restart all  # ou seu comando de restart
   ```

---

### 5. Monitorar (Primeira Semana)

**Logs para acompanhar:**

```bash
# Ver se heurística está funcionando
grep "source: heuristic" logs/app.log | wc -l

# Ver se Gemini ainda é chamado (deve ser ~40% das mensagens)
grep "source: gemini" logs/app.log | wc -l
```

**Métricas esperadas:**
- ✅ ~60% das mensagens usam heurística
- ✅ ~40% das mensagens chamam Gemini
- ✅ 0 erros de UPSERT (se migration aplicada)
- ✅ Latência reduzida em ~50% para mensagens comuns

---

## 🐛 Troubleshooting

### Problema: "Constraint já existe"

**Solução:** Normal! A migration é idempotente. Pode ignorar o erro ou verificar se a constraint já existe.

### Problema: "UPSERT não funciona, ainda faz 2 queries"

**Causa:** Migration não foi aplicada ou constraint não existe.

**Solução:**
1. Verifique se a migration foi aplicada (passo 2)
2. Se não, aplique manualmente
3. O código tem fallback automático (usa método antigo se UPSERT falhar)

### Problema: "Heurística não detecta nada, sempre chama Gemini"

**Causa:** Cache do Redis pode estar desabilitado ou mensagens muito complexas.

**Solução:**
1. Verifique se `REDIS_URL` está configurada
2. Se não tiver Redis, a heurística ainda funciona (só não cacheia)
3. Mensagens muito complexas/ambíguas devem chamar Gemini mesmo (isso é esperado)

### Problema: "Erro ao criar cliente/procedimento"

**Causa:** Pode ser problema de permissões RLS ou constraint.

**Solução:**
1. Verifique RLS policies no Supabase
2. Verifique se o usuário tem permissão para INSERT/UPDATE
3. O código tem fallback automático (tenta método antigo se UPSERT falhar)

---

## 📊 Checklist Final

- [ ] Migration aplicada no banco de dados
- [ ] Constraints verificadas (passo 2)
- [ ] Testado localmente (opcional)
- [ ] Deploy feito para produção
- [ ] Monitoramento ativo (primeira semana)

---

## 💰 Economia Esperada

Após aplicar tudo:
- **$600-900/mês** economizados
- **~$7.200-10.800/ano** economizados
- **50% menos latência** para mensagens comuns

---

## 📞 Suporte

Se tiver problemas:
1. Verifique os logs do servidor
2. Verifique se a migration foi aplicada
3. Verifique se Redis está configurado (opcional, mas recomendado)
4. O código tem fallbacks automáticos - deve funcionar mesmo se algo falhar

---

**Pronto! Siga os passos acima e as otimizações estarão ativas.** 🎉
