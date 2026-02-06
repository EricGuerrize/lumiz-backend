-- ==============================================================================
-- FINANCIAL DATA CONSOLIDATION VIEWS
-- ==============================================================================
-- This script unifies 'atendimentos' (income) and 'contas_pagar' (expense)
-- into a single ledger text to simplify financial reporting and balance calculations.
--
-- CRITICAL: strict type casting ::numeric and ::date is used to prevent
-- "numeric vs numeric(x,y)" type mismatch errors during UNION operations.

-- DROP VIEWS to handle type changes (e.g. numeric -> integer)
DROP VIEW IF EXISTS view_monthly_report;
DROP VIEW IF EXISTS view_finance_balance;
DROP VIEW IF EXISTS view_financial_ledger;

-- 1. view_financial_ledger
-- Unifies income and expense streams.
CREATE OR REPLACE VIEW view_financial_ledger AS
SELECT
    id,
    user_id,
    'entrada'::text as type,
    valor_total::numeric as valor,
    data::date as data,
    -- Extract category name from first procedure or fallback
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
    data::date as data,
    categoria::text as categoria,
    descricao::text as descricao,
    status_pagamento::text as status,
    'outros'::text as payment_method,
    created_at
FROM contas_pagar;

-- 2. view_finance_balance
-- Real-time balance aggregation per user.
-- Columns aliased to match legacy usage: saldo, total_receitas, total_despesas
CREATE OR REPLACE VIEW view_finance_balance AS
SELECT
    user_id,
    SUM(CASE WHEN type = 'entrada' THEN valor ELSE 0 END)::numeric as total_receitas,
    SUM(CASE WHEN type = 'saida' THEN valor ELSE 0 END)::numeric as total_despesas,
    (
        SUM(CASE WHEN type = 'entrada' THEN valor ELSE 0 END) - 
        SUM(CASE WHEN type = 'saida' THEN valor ELSE 0 END)
    )::numeric as saldo
FROM view_financial_ledger
GROUP BY user_id;

-- 3. view_monthly_report
-- Monthly aggregation for reporting.
-- Columns aliased to match legacy usage: receitas, despesas, total_transacoes
CREATE OR REPLACE VIEW view_monthly_report AS
SELECT
    user_id,
    EXTRACT(YEAR FROM data)::integer as ano,
    EXTRACT(MONTH FROM data)::integer as mes,
    SUM(CASE WHEN type = 'entrada' THEN valor ELSE 0 END)::numeric as receitas,
    SUM(CASE WHEN type = 'saida' THEN valor ELSE 0 END)::numeric as despesas,
    COUNT(*)::integer as total_transacoes,
    (
        SUM(CASE WHEN type = 'entrada' THEN valor ELSE 0 END) - 
        SUM(CASE WHEN type = 'saida' THEN valor ELSE 0 END)
    )::numeric as saldo
FROM view_financial_ledger
GROUP BY user_id, EXTRACT(YEAR FROM data), EXTRACT(MONTH FROM data);
