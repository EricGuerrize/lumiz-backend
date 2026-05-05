CREATE OR REPLACE VIEW view_finance_balance AS
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
FROM view_financial_ledger l
LEFT JOIN profiles p ON p.id = l.user_id
GROUP BY l.user_id, p.initial_balance;;
