-- Histórico de alertas de emergência enviados (auditoria)

CREATE TABLE IF NOT EXISTS public.emergency_alert_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'caixa_negativo',
  saldo_minimo numeric(14, 2),
  data_risco date,
  canal text NOT NULL DEFAULT 'whatsapp',
  enviado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emergency_alert_history_user ON public.emergency_alert_history(user_id, enviado_em DESC);

ALTER TABLE public.emergency_alert_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own emergency_alert_history" ON public.emergency_alert_history;
CREATE POLICY "users read own emergency_alert_history"
  ON public.emergency_alert_history FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.emergency_alert_history IS 'Registros de alertas de caixa negativo (e similares) enviados ao utilizador.';
