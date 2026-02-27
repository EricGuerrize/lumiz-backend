# Secrets Rotation Playbook

## Objetivo
Padronizar rotação de credenciais críticas para reduzir risco de vazamento e uso indevido.

## Escopo
- `SUPABASE_SERVICE_ROLE_KEY`
- `EVOLUTION_API_KEY`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY` (quando ativo)
- `SENTRY_DSN`
- `CRON_SECRET`
- `METRICS_TOKEN`

## Frequência
- Rotação trimestral (a cada 90 dias)
- Rotação imediata em incidente/suspeita de exposição

## Checklist operacional
1. Gerar nova credencial no provedor.
2. Atualizar segredo no ambiente de `staging`.
3. Validar saúde e fluxos críticos em `staging`.
4. Atualizar segredo no ambiente de `produção`.
5. Reiniciar serviços afetados (API/worker).
6. Confirmar logs sem erro de autenticação por 30 minutos.
7. Revogar credencial anterior.
8. Registrar rotação em changelog interno (data, escopo, responsável).

## Ordem recomendada por serviço
1. Observabilidade (`SENTRY_DSN`) e tokens internos (`CRON_SECRET`, `METRICS_TOKEN`)
2. IA (`GEMINI_API_KEY`, `OPENAI_API_KEY`)
3. Infra de dados (`SUPABASE_SERVICE_ROLE_KEY`)
4. Integrações externas (`EVOLUTION_API_KEY`)

## Plano de rollback
1. Reaplicar segredo anterior apenas se incidente de indisponibilidade.
2. Abrir incidente interno com causa raiz.
3. Planejar nova janela de rotação em até 24h.

## Sinais de sucesso
- `health` sem degradação após rotação.
- Ausência de `401/403` nas integrações.
- Filas e jobs assíncronos processando normalmente.
