-- Teto opcional de estoque por procedimento (alerta de excesso)

ALTER TABLE public.procedimentos
  ADD COLUMN IF NOT EXISTS estoque_maximo numeric(14, 4);

COMMENT ON COLUMN public.procedimentos.estoque_maximo IS 'Nível máximo desejado; acima disso o status pode ser "excesso" para alertas.';
