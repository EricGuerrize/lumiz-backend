-- ==============================================================================
-- FINANCIAL DATA CONSOLIDATION VIEWS
-- ==============================================================================
DROP VIEW IF EXISTS view_monthly_report;
DROP VIEW IF EXISTS view_finance_balance;
DROP VIEW IF EXISTS view_financial_ledger;

CREATE OR REPLACE VIEW view_financial_ledger AS
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
    created_at
FROM atendimentos

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
    created_at
FROM contas_pagar;

CREATE OR REPLACE VIEW view_finance_balance AS
SELECT
    user_id,
    SUM(CASE WHEN type = 'entrada' THEN valor ELSE 0 END)::numeric as total_receitas,
    SUM(CASE WHEN type = 'entrada' THEN COALESCE(valor_bruto, valor) ELSE 0 END)::numeric as total_receitas_brutas,
    SUM(CASE WHEN type = 'entrada' THEN COALESCE(valor_liquido, valor) ELSE 0 END)::numeric as total_receitas_liquidas,
    SUM(CASE WHEN type = 'saida' THEN valor ELSE 0 END)::numeric as total_despesas,
    (
        SUM(CASE WHEN type = 'entrada' THEN valor ELSE 0 END) - 
        SUM(CASE WHEN type = 'saida' THEN valor ELSE 0 END)
    )::numeric as saldo
FROM view_financial_ledger
GROUP BY user_id;

CREATE OR REPLACE VIEW view_monthly_report AS
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
FROM view_financial_ledger
GROUP BY user_id, EXTRACT(YEAR FROM data), EXTRACT(MONTH FROM data);;
