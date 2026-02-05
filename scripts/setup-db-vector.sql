-- 1. Habilitar a extensão pgvector (necessária para busca semântica)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Criar a tabela de conhecimento aprendido
CREATE TABLE IF NOT EXISTS learned_knowledge (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content TEXT NOT NULL,                  -- O texto original da mensagem
    embedding vector(768),                 -- Vetor representando o texto (768 é o padrão do Gemini text-embedding-004)
    intent_name TEXT NOT NULL,              -- O intent detectado (ex: registrar_receita)
    metadata JSONB DEFAULT '{}'::jsonb,     -- Dados extras como categoria, tags, etc.
    is_global BOOLEAN DEFAULT false,        -- Se esse conhecimento serve para todos ou só para essa clínica
    clinic_id UUID REFERENCES clinics(id),  -- (Opcional) Escopo por clínica
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Criar um índice para busca vetorial rápida (opcional, recomendado com muitos dados)
-- O tamanho 768 deve bater com o serviço de embeddings
CREATE INDEX IF NOT EXISTS learned_knowledge_embedding_idx ON learned_knowledge USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 4. Criar a função RPC para busca de similaridade
CREATE OR REPLACE FUNCTION match_learned_knowledge (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  p_clinic_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  intent_name TEXT,
  metadata JSONB,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    lk.id,
    lk.content,
    lk.intent_name,
    lk.metadata,
    1 - (lk.embedding <=> query_embedding) AS similarity
  FROM learned_knowledge lk
  WHERE (lk.is_global = true OR (p_clinic_id IS NOT NULL AND lk.clinic_id = p_clinic_id))
    AND 1 - (lk.embedding <=> query_embedding) > match_threshold
  ORDER BY lk.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
