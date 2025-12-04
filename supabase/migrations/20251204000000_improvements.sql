-- Migration: Standardize Status and Improve Performance
-- Description: Creates enums for payment status and views for balance calculation.

-- 1. Create Enums for Status Standardization
-- This ensures we only have valid statuses in the database.

-- Check if type exists before creating to avoid errors
DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('pago', 'pendente', 'agendado', 'atrasado', 'cancelado');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Check if type exists before creating
DO $$ BEGIN
    CREATE TYPE payment_method AS ENUM ('avista', 'parcelado', 'cartao_credito', 'cartao_debito', 'pix', 'dinheiro', 'boleto');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Create View for Balance Calculation (Performance)
-- This allows calculating the balance directly in the database, much faster than in JS.

CREATE OR REPLACE VIEW view_finance_balance AS
SELECT
    user_id,
    COALESCE(SUM(CASE WHEN tipo_transacao = 'entrada' THEN valor_total ELSE 0 END), 0) as total_receitas,
    COALESCE(SUM(CASE WHEN tipo_transacao = 'saida' THEN valor_total ELSE 0 END), 0) as total_despesas,
    (
        COALESCE(SUM(CASE WHEN tipo_transacao = 'entrada' THEN valor_total ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN tipo_transacao = 'saida' THEN valor_total ELSE 0 END), 0)
    ) as saldo
FROM (
    -- Entradas (Atendimentos)
    SELECT user_id, valor_total, 'entrada' as tipo_transacao FROM atendimentos
    UNION ALL
    -- Saídas (Contas a Pagar)
    SELECT user_id, valor, 'saida' as tipo_transacao FROM contas_pagar
) as transacoes
GROUP BY user_id;

-- 3. Create View for Monthly Report
-- Simplifies the monthly report query

CREATE OR REPLACE VIEW view_monthly_report AS
SELECT
    user_id,
    EXTRACT(YEAR FROM data) as ano,
    EXTRACT(MONTH FROM data) as mes,
    COALESCE(SUM(CASE WHEN tipo_transacao = 'entrada' THEN valor_total ELSE 0 END), 0) as receitas,
    COALESCE(SUM(CASE WHEN tipo_transacao = 'saida' THEN valor_total ELSE 0 END), 0) as despesas,
    COUNT(*) as total_transacoes
FROM (
    SELECT user_id, valor_total, data, 'entrada' as tipo_transacao FROM atendimentos
    UNION ALL
    SELECT user_id, valor, data, 'saida' as tipo_transacao FROM contas_pagar
) as transacoes
GROUP BY user_id, EXTRACT(YEAR FROM data), EXTRACT(MONTH FROM data);

-- 4. Instructions for Legacy Tables (transactions, categories, users)
-- WARNING: Only run this if you are sure you want to delete legacy data.
-- To delete the 'users' table, you must first drop the dependencies.

-- DROP TABLE IF EXISTS transactions CASCADE;
-- DROP TABLE IF EXISTS categories CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;
