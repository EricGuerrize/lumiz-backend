-- Fase 17 — separa lançamentos de teste dos relatórios financeiros padrão.
-- `view_financial_ledger_all` preserva auditoria; as views usadas pelo app
-- (`view_financial_ledger`, `view_finance_balance`, `view_monthly_report`)
-- passam a excluir `is_test = true`.

DROP VIEW IF EXISTS public.view_monthly_report;
DROP VIEW IF EXISTS public.view_finance_balance;
DROP VIEW IF EXISTS public.view_financial_ledger;
DROP VIEW IF EXISTS public.view_financial_ledger_all;

CREATE OR REPLACE VIEW public.view_financial_ledger_all AS
SELECT
    id,
    user_id,
    'entrada'::text as type,
    CASE
        WHEN LOWER(forma_pagamento::text) IN ('debito', 'débito', 'credito_avista', 'crédito_avista', 'parcelado')
            THEN COALESCE(valor_liquido, valor_total)::numeric
        ELSE COALESCE(valor_bruto, valor_total)::numeric
    END as valor,
    COALESCE(valor_bruto, valor_total)::numeric as valor_bruto,
    COALESCE(valor_liquido, valor_total)::numeric as valor_liquido,
    mdr_percent_applied::numeric as mdr_percent_applied,
    data::date as data,
    recebimento_previsto::date as recebimento_previsto,
    COALESCE(
        (SELECT p.nome
         FROM atendimento_procedimentos ap
         JOIN procedimentos p ON p.id = ap.procedimento_id
         WHERE ap.atendimento_id = atendimentos.id
         LIMIT 1),
        'Procedimento'
    )::text as categoria,
    observacoes::text as descricao,
    status_pagamento::text as status,
    forma_pagamento::text as payment_method,
    COALESCE(is_test, false)::boolean as is_test,
    origem::text as origem,
    source_message_id::text as source_message_id,
    created_at
FROM public.atendimentos

UNION ALL

SELECT
    id,
    user_id,
    'saida'::text as type,
    valor::numeric as valor,
    valor::numeric as valor_bruto,
    valor::numeric as valor_liquido,
    NULL::numeric as mdr_percent_applied,
    data::date as data,
    data::date as recebimento_previsto,
    categoria::text as categoria,
    descricao::text as descricao,
    status_pagamento::text as status,
    'outros'::text as payment_method,
    COALESCE(is_test, false)::boolean as is_test,
    origem::text as origem,
    source_message_id::text as source_message_id,
    created_at
FROM public.contas_pagar;

CREATE OR REPLACE VIEW public.view_financial_ledger AS
SELECT *
FROM public.view_financial_ledger_all
WHERE is_test IS NOT TRUE;

CREATE OR REPLACE VIEW public.view_finance_balance AS
SELECT
  l.user_id,
  sum(CASE WHEN l.type = 'entrada' THEN l.valor ELSE 0 END) AS total_receitas,
  sum(CASE WHEN l.type = 'entrada' THEN COALESCE(l.valor_bruto, l.valor) ELSE 0 END) AS total_receitas_brutas,
  sum(CASE WHEN l.type = 'entrada' THEN COALESCE(l.valor_liquido, l.valor) ELSE 0 END) AS total_receitas_liquidas,
  sum(CASE WHEN l.type = 'saida' THEN l.valor ELSE 0 END) AS total_despesas,
  COALESCE(p.initial_balance, 0)
    + sum(CASE WHEN l.type = 'entrada' THEN l.valor ELSE 0 END)
    - sum(CASE WHEN l.type = 'saida' THEN l.valor ELSE 0 END) AS saldo,
  COALESCE(p.initial_balance, 0) AS initial_balance
FROM public.view_financial_ledger l
LEFT JOIN public.profiles p ON p.id = l.user_id
GROUP BY l.user_id, p.initial_balance;

CREATE OR REPLACE VIEW public.view_monthly_report AS
SELECT
    user_id,
    EXTRACT(YEAR FROM data)::integer as ano,
    EXTRACT(MONTH FROM data)::integer as mes,
    SUM(CASE WHEN type = 'entrada' THEN valor ELSE 0 END)::numeric as receitas,
    SUM(CASE WHEN type = 'entrada' THEN COALESCE(valor_bruto, valor) ELSE 0 END)::numeric as receitas_brutas,
    SUM(CASE WHEN type = 'entrada' THEN COALESCE(valor_liquido, valor) ELSE 0 END)::numeric as receitas_liquidas,
    SUM(CASE WHEN type = 'saida' THEN valor ELSE 0 END)::numeric as despesas,
    COUNT(*)::integer as total_transacoes,
    (
        SUM(CASE WHEN type = 'entrada' THEN valor ELSE 0 END) -
        SUM(CASE WHEN type = 'saida' THEN valor ELSE 0 END)
    )::numeric as saldo
FROM public.view_financial_ledger
GROUP BY user_id, EXTRACT(YEAR FROM data), EXTRACT(MONTH FROM data);

ALTER VIEW public.view_financial_ledger_all SET (security_invoker = on);
ALTER VIEW public.view_financial_ledger SET (security_invoker = on);
ALTER VIEW public.view_finance_balance SET (security_invoker = on);
ALTER VIEW public.view_monthly_report SET (security_invoker = on);

COMMENT ON VIEW public.view_financial_ledger_all IS
  'Ledger financeiro completo, incluindo lançamentos is_test=true para auditoria interna.';
COMMENT ON VIEW public.view_financial_ledger IS
  'Ledger financeiro padrão usado pelo app. Exclui lançamentos is_test=true.';
