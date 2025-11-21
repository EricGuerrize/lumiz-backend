# 🧹 Como Limpar Dados de Teste

Para testar o bot desde o zero, você precisa limpar:

1. **Dados no Supabase** (perfil e onboarding)
2. **Cache em memória** (Map do userController)

## 📋 Passo a Passo

### 1. Limpar Dados no Supabase

**Opção A: Via SQL Editor no Supabase**

1. Acesse o Supabase Dashboard
2. Vá em **SQL Editor**
3. Execute o script abaixo (substitua `SEU_TELEFONE` pelo seu número):

```sql
-- Limpar perfil
DELETE FROM public.profiles
WHERE telefone = 'SEU_TELEFONE';

-- Limpar onboarding
DELETE FROM public.onboarding_progress
WHERE phone = 'SEU_TELEFONE';

-- Verificar (deve retornar 0)
SELECT 
  (SELECT COUNT(*) FROM public.profiles WHERE telefone = 'SEU_TELEFONE') as profiles_count,
  (SELECT COUNT(*) FROM public.onboarding_progress WHERE phone = 'SEU_TELEFONE') as onboarding_count;
```

**Opção B: Via Terminal (psql)**

```bash
# Conecte ao Supabase e execute:
psql "sua_connection_string" -c "
DELETE FROM public.profiles WHERE telefone = 'SEU_TELEFONE';
DELETE FROM public.onboarding_progress WHERE phone = 'SEU_TELEFONE';
"
```

### 2. Limpar Cache em Memória

O cache em memória (`onboardingData` Map) é limpo automaticamente quando:

- ✅ O servidor é reiniciado
- ✅ O onboarding é completado
- ✅ O onboarding expira (após 1 hora de inatividade)

**Para forçar limpeza imediata:**

1. **Reinicie o servidor:**
   ```bash
   # Se estiver rodando localmente
   # Pare o servidor (Ctrl+C) e inicie novamente
   npm start
   
   # Se estiver no Railway
   # Faça um redeploy ou reinicie o serviço
   ```

2. **Ou aguarde 1 hora** (o Map limpa automaticamente após inatividade)

### 3. Verificar se Funcionou

Após limpar, envie uma mensagem qualquer para o bot. Ele deve:

- ✅ Detectar como **novo usuário**
- ✅ Enviar as **3 mensagens iniciais** (se novo) ou mensagem de boas-vindas (se antigo mas sem dados)
- ✅ Começar o onboarding do **passo 1** (nome completo)

## 🔍 Como o Bot Detecta Usuário Novo vs Antigo

O bot verifica nesta ordem:

1. **Tem perfil em `profiles`?** → Usuário antigo
2. **Tem onboarding completo em `onboarding_progress`?** → Usuário antigo
3. **Nenhum dos dois?** → Usuário novo

## ⚠️ Importante

- O número de telefone deve estar no formato usado pelo WhatsApp (ex: `556592556938`)
- Se você deletar apenas `onboarding_progress` mas tiver `profiles`, ainda será detectado como antigo
- Para testar como novo usuário, **deve deletar ambos** (`profiles` E `onboarding_progress`)

## 🚀 Script Rápido

Crie um arquivo `limpar-teste.sh`:

```bash
#!/bin/bash
TELEFONE="556592556938"  # Substitua pelo seu número

# Execute no Supabase SQL Editor:
echo "DELETE FROM public.profiles WHERE telefone = '$TELEFONE';"
echo "DELETE FROM public.onboarding_progress WHERE phone = '$TELEFONE';"
```

---

**Pronto!** Após limpar os dados e reiniciar o servidor, você pode testar desde o zero! 🎉

