-- Criar tabela de orçamentos (cotações)
CREATE TABLE public.orcamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  cliente_id UUID NOT NULL,
  numero_orcamento TEXT NOT NULL,
  data_criacao DATE NOT NULL DEFAULT CURRENT_DATE,
  data_validade DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente', -- pendente, aprovado, rejeitado, expirado
  valor_total NUMERIC NOT NULL DEFAULT 0,
  desconto_percentual NUMERIC DEFAULT 0,
  desconto_valor NUMERIC DEFAULT 0,
  valor_final NUMERIC NOT NULL DEFAULT 0,
  observacoes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de itens do orçamento
CREATE TABLE public.orcamento_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id UUID NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
  procedimento_id UUID NOT NULL,
  quantidade INTEGER NOT NULL DEFAULT 1,
  valor_unitario NUMERIC NOT NULL,
  valor_total NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.orcamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_itens ENABLE ROW LEVEL SECURITY;

-- Políticas para orçamentos
CREATE POLICY "Usuários podem ver seus próprios orçamentos"
ON public.orcamentos FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Usuários podem criar seus próprios orçamentos"
ON public.orcamentos FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuários podem atualizar seus próprios orçamentos"
ON public.orcamentos FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Usuários podem deletar seus próprios orçamentos"
ON public.orcamentos FOR DELETE
USING (auth.uid() = user_id);

-- Políticas para itens de orçamento
CREATE POLICY "Usuários podem ver itens de seus orçamentos"
ON public.orcamento_itens FOR SELECT
USING (EXISTS (
  SELECT 1 FROM orcamentos 
  WHERE orcamentos.id = orcamento_itens.orcamento_id 
  AND orcamentos.user_id = auth.uid()
));

CREATE POLICY "Usuários podem criar itens em seus orçamentos"
ON public.orcamento_itens FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM orcamentos 
  WHERE orcamentos.id = orcamento_itens.orcamento_id 
  AND orcamentos.user_id = auth.uid()
));

CREATE POLICY "Usuários podem atualizar itens de seus orçamentos"
ON public.orcamento_itens FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM orcamentos 
  WHERE orcamentos.id = orcamento_itens.orcamento_id 
  AND orcamentos.user_id = auth.uid()
));

CREATE POLICY "Usuários podem deletar itens de seus orçamentos"
ON public.orcamento_itens FOR DELETE
USING (EXISTS (
  SELECT 1 FROM orcamentos 
  WHERE orcamentos.id = orcamento_itens.orcamento_id 
  AND orcamentos.user_id = auth.uid()
));

-- Trigger para updated_at
CREATE TRIGGER update_orcamentos_updated_at
BEFORE UPDATE ON public.orcamentos
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Função para gerar número de orçamento
CREATE OR REPLACE FUNCTION generate_orcamento_numero()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_numero TEXT;
BEGIN
  SELECT COUNT(*) INTO v_count 
  FROM orcamentos 
  WHERE user_id = auth.uid() 
  AND EXTRACT(YEAR FROM data_criacao) = EXTRACT(YEAR FROM CURRENT_DATE);
  
  v_numero := 'ORC-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
  
  RETURN v_numero;
END;
$$;;
