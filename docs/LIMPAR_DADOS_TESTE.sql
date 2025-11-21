-- Script para limpar dados de teste e permitir testar o bot desde o zero
-- Número: 65992556938

-- 1. Deletar perfil (se existir)
DELETE FROM public.profiles
WHERE telefone = '65992556938' OR telefone = '5565992556938';

-- 2. Deletar progresso de onboarding (se existir)
DELETE FROM public.onboarding_progress
WHERE phone = '65992556938' OR phone = '5565992556938';

-- 3. Deletar histórico de conversas (opcional)
DELETE FROM public.conversation_history
WHERE user_id IN (
  SELECT id FROM public.profiles 
  WHERE telefone = '65992556938' OR telefone = '5565992556938'
);

-- 4. Deletar transações (opcional)
DELETE FROM public.transactions
WHERE user_id IN (
  SELECT id FROM public.profiles 
  WHERE telefone = '65992556938' OR telefone = '5565992556938'
);

-- 5. Deletar categorias (opcional)
DELETE FROM public.categories
WHERE user_id IN (
  SELECT id FROM public.profiles 
  WHERE telefone = '65992556938' OR telefone = '5565992556938'
);

-- Verificar se foi limpo (deve retornar 0 linhas)
SELECT 
  (SELECT COUNT(*) FROM public.profiles 
   WHERE telefone = '65992556938' OR telefone = '5565992556938') as profiles_count,
  (SELECT COUNT(*) FROM public.onboarding_progress 
   WHERE phone = '65992556938' OR phone = '5565992556938') as onboarding_count;

