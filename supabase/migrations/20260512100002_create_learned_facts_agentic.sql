-- Fase Agentic 1.3 — Fatos aprendidos sobre a clínica (memória de longo prazo)
-- Complementa learned_knowledge com fatos específicos por clínica para busca semântica.
-- Diferença: learned_knowledge é RAG de exemplos de intent; learned_facts_agentic é memória da clínica.

CREATE TABLE IF NOT EXISTS public.learned_facts_agentic (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Vínculo com clínica
  clinic_id uuid NOT NULL REFERENCES public.clinic_profiles(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  
  -- O fato aprendido
  fact text NOT NULL,
  fact_type varchar(64) DEFAULT 'general',
  -- fact_type: vendor_pattern, payment_pattern, seasonality, client_pattern, procedure_pattern, general
  
  -- Embedding para busca semântica
  embedding vector(1536),
  
  -- Confiança e evidências
  confidence float DEFAULT 0.5,
  -- confidence: 0.0 a 1.0
  supporting_records text[] DEFAULT '{}',
  -- IDs de transações/documentos que suportam este fato
  
  -- Validade
  is_active boolean DEFAULT true,
  invalidated_at timestamptz,
  invalidated_reason text,
  
  -- Metadata
  source varchar(32) DEFAULT 'inferred',
  -- source: inferred, user_stated, document_extracted, profile_builder
  
  -- Timestamps
  learned_at timestamptz DEFAULT now(),
  last_used_at timestamptz,
  use_count int DEFAULT 0,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Índice vetorial para busca de similaridade
CREATE INDEX IF NOT EXISTS idx_learned_facts_agentic_embedding
  ON public.learned_facts_agentic 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Índices para filtros comuns
CREATE INDEX IF NOT EXISTS idx_learned_facts_agentic_clinic_id 
  ON public.learned_facts_agentic(clinic_id);

CREATE INDEX IF NOT EXISTS idx_learned_facts_agentic_fact_type 
  ON public.learned_facts_agentic(fact_type)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_learned_facts_agentic_confidence 
  ON public.learned_facts_agentic(confidence DESC)
  WHERE is_active = true;

-- RLS
ALTER TABLE public.learned_facts_agentic ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own clinic facts" ON public.learned_facts_agentic;
CREATE POLICY "users can read own clinic facts"
  ON public.learned_facts_agentic FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Função RPC para busca semântica de fatos
CREATE OR REPLACE FUNCTION match_learned_facts_agentic(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_clinic_id uuid
)
RETURNS TABLE (
  id uuid,
  fact text,
  fact_type varchar(64),
  confidence float,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    lf.id,
    lf.fact,
    lf.fact_type,
    lf.confidence,
    1 - (lf.embedding <=> query_embedding) AS similarity
  FROM public.learned_facts_agentic lf
  WHERE
    lf.clinic_id = p_clinic_id
    AND lf.is_active = true
    AND lf.embedding IS NOT NULL
    AND 1 - (lf.embedding <=> query_embedding) > match_threshold
  ORDER BY lf.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_learned_facts_agentic_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS learned_facts_agentic_updated_at ON public.learned_facts_agentic;
CREATE TRIGGER learned_facts_agentic_updated_at
  BEFORE UPDATE ON public.learned_facts_agentic
  FOR EACH ROW
  EXECUTE FUNCTION update_learned_facts_agentic_updated_at();

COMMENT ON TABLE public.learned_facts_agentic IS
  'Fase Agentic 1.3 — Fatos aprendidos sobre a clínica (memória de longo prazo) com busca semântica via embeddings.';
