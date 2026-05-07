# Lumiz Financeiro — Roadmap de Implementação

> Documento vivo. Atualizar status a cada entrega.
> Fases 1–10 concluídas (back + front, quando aplicável). Preset opcional: simulador “cortar pró-labore”. Fases 11–20 pendentes.

---

## Tabela de Progresso

| # | Fase | Escopo | Esforço | Status |
|---|---|---|---|---|
| 1 | Régua de cobrança + meta financeira | Back | P | ✅ Concluído |
| 2 | Cashflow + Calendário + Contas a Pagar | Back | M | ✅ Concluído |
| 3 | Simulador + Pricing + Emergency + Export | Back | G | ✅ Concluído |
| 4 | Estoque (serviço + bot + endpoints) | Back | G | ✅ Concluído |
| 5 | Dashboard backend completo (health score, inadimplência, sazonalidade, goals, custo real, caminho da meta) | Back | G | ✅ Concluído |
| 6 | Email report, perfil de pagamento, margem comparativa, NF validade, rate limiting | Back | M | ✅ Concluído |
| 7 | Pró-labore como categoria especial | Back + Front | P | ✅ Concluído (preset simulador opcional) |
| 8 | Comissão por colaborador | Back + Front | M | ✅ Concluído |
| 9 | Estados Empty/Sparse na UI | Front | P | ✅ Concluído |
| 10 | Frontend Phases 4–6 (Estoque, Health Score, Inadimplência, Sazonalidade, Outlook, Goals) | Front | G | ✅ Concluído |
| 11 | Capture Agent — confidence score + confirmação WhatsApp | Back | M | ✅ Concluído (Onda 1, áudio Whisper incluído) |
| 12 | Importador de planilha Excel | Back + Front | G | ⬜ Pendente |
| 13 | Export OFX para contador | Back + Front | P | ⬜ Pendente |
| 14 | Multi-tenant / switch de clínica | Back + Front | G | ⬜ Pendente |
| 15 | Audit log | Back + Front | M | ⬜ Pendente |
| 16 | Feature flags | Back + Front | P | ✅ Concluído — frontend com `useFeatureFlag` + `AlterGate`; **`GET /api/config/features` ainda pendente no backend** (degradação segura → flags `false`) |
| 17 | Analytics de produto (PostHog) | Back + Front | M | ⬜ Pendente |
| 18 | MFA obrigatório | Back + Front | M | ⬜ Pendente |
| 19 | LGPD: export de dados + direito ao esquecimento | Back + Front | M | ⬜ Pendente |
| 20 | Integrações futuras (Pluggy, Adquirentes, NFe.io, Alter) | Back | G | ⏸️ Bloqueado go-live (Alter real — falta sandbox/contrato) |
| 21 | Ondas 2–4 frontend (Supplier Docs, Fornecedores, Contas a receber, painéis Alter) | Front | G | ✅ Concluído — ver `lumiz-financeiro/HANDOFF_FRONTEND.md` (Onda 1–4) |
| 20.4 | Alter — telas dashboard | Front | M | 🟡 Concluído (mock) — `/dashboard/alter/*` atrás de `alter_enabled`; produção depende da fase 20 |

---

## Concluído — Fases 1–6

Referência rápida do que está implementado. Não retrabalhar.

- **Phase 1** — `reminderService.js`, `goalReminderService.js`, `reminderSentHelper.js`, crons WhatsApp, migrations `reminders_sent` e `meta_mensal`.
- **Phase 2** — `cashflowService.js` (3 métodos), endpoints `/contas-a-pagar`, `/cashflow/projection`, `/calendar`.
- **Phase 3** — `simulatorService.js`, `pricingIntelligenceService.js`, `emergencyModeService.js`, `exportService.js` (PDF/CSV), endpoints Phase 3, `emergencyWhatsappCopy.js`.
- **Phase 4** — `estoqueService.js`, `estoqueWhatsappCopy.js`, `estoqueHandler.js`, migrations `fornecedores` e `movimentacoes_estoque`, 4 endpoints de estoque.
- **Phase 5** — `healthScoreService.js`, `inadimplenciaService.js`, `sazonalidadeService.js`, `metaCaminhoService.js`, `procedimentoCustoService.js`, migration `monthly_goals`, 10+ endpoints.
- **Phase 6** — `emailReportService.js`, `clientePerfilService.js`, `margemAlertaService.js`, `nfValidadeService.js`, `monthlyReportDeliveryService.js`, rate limiting, 44 testes no regression suite.

**Frontend concluído:** ContasPagar (+ pró-labore), Pró-labore (`/dashboard/prolabore`), Colaboradores (`/dashboard/colaboradores`), Cashflow, Simulador (multi-período), Precificação + Custo Real (comissão no breakdown), Estoque, NF/Validade, Inadimplência, Sazonalidade, Health Score (`HealthScoreCard` + opcional `cobertura_fornecedor`), Goals/Meta (3 campos), Emergency (detalhes + histórico), Export (PDF/CSV), Sidebar (Visão geral, Inteligência, **Análises**, **Powered by Alter** condicional, Operacional). **Onda 2–4:** Documentos de fornecedor (`/dashboard/supplier-docs`), Fornecedores, Contas a receber, painéis Alter (`/dashboard/alter/*`).

---

## Fase 7 — Pró-labore como categoria especial

**Objetivo:** separar pró-labore dos custos operacionais para que cálculos de margem e simulações reflitam a realidade.

**Impacto de negócio:** todos os usuários ativos têm margem calculada incorretamente enquanto pró-labore estiver junto com custos operacionais. Correção imediata.

**Backend:**
- Migration: `ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS is_pro_labore BOOLEAN DEFAULT false`
- Atualizar `procedimentoCustoService.js` — excluir `is_pro_labore = true` do cálculo de custo operacional
- Atualizar `healthScoreService.js` — separar pró-labore ao calcular margem
- Atualizar `outlookService.js` — exibir pró-labore como linha separada no DRE
- Endpoint `GET /api/dashboard/summary` — adicionar `pro_labore_mensal` no response
- Sugestão de % saudável: alertar se `pro_labore / receita > 0.15` (15% de referência do handoff)

**Frontend:**
- Formulário de lançamento de conta a pagar: toggle "É pró-labore?"
- Relatório mensal: linha separada "Pró-labore" antes do lucro líquido
- Card de simulação: opção "e se eu cortar pró-labore em X%?" como preset

**Dependências:** nenhuma.

**Definition of Done:**
- Migration aplicada em produção
- `healthScoreService` retorna `margem` excluindo pró-labore
- Testes unitários atualizados (mínimo 2 novos casos)
- Frontend exibe pró-labore separado no relatório

**Esforço:** P

**Status atual (2026-05-05):**
- **Entregue em backend**
  - Migration `20260504000001_prolabore_flag.sql` criada (`contas_pagar.is_pro_labore` + índice parcial).
  - `cashflowService` propaga `is_pro_labore` em eventos de `getCashflowProjection` e `getFinancialCalendar`.
  - `healthScoreService` já considera despesas operacionais sem pró-labore no componente de margem.
  - `procedimentoCustoService` separa `total_pro_labore_periodo` e `total_despesas_operacionais_periodo`.
  - Endpoints: `GET /api/dashboard/prolabore` e `PATCH /api/dashboard/prolabore/:id`.
  - `GET /api/dashboard/summary` agora expõe `pro_labore_mensal` e `pro_labore_ratio_receita`.
  - `outlookService` expõe `custos_operacionais` e `pro_labore` por mês (com pró-labore fora da margem operacional).
- **Validação backend**
  - Smoke de rotas: OK.
  - `npm run test:regression`: OK.
  - Testes focados (`cashflowService`, `outlookService`): OK.
- **Frontend (2026-05-05)**
  - Toggle “É pró-labore?” em Contas a Pagar; página `/dashboard/prolabore` (lista + toggle); dashboard com total/razão e alerta &gt;15%; relatório mensal com card Pró-labore + link.
  - **Ainda opcional (DoD estendido):** preset “cortar pró-labore X%” no simulador.
- **Observação de deploy**
  - Histórico Supabase foi alinhado com `supabase migration fetch` + remoção de duplicados locais; `supabase db push --include-all` aplica pendências. Ambientes novos precisam da coluna `contas_pagar.is_pro_labore` e das tabelas `colaboradores` / `comissoes` (migrations `20260504000001`, `20260507000014`, `20260507000015`).

---

## Fase 8 — Comissão por colaborador

**Objetivo:** registrar comissão de cada colaboradora por procedimento para que o custo real reflita o custo de mão de obra.

**Impacto de negócio:** sem comissão, o `custo_real` por procedimento mente — funcionalidade central do produto. A planilha da NB Clinic já mostra Yamara, Thalia, Amy com comissões diferentes.

**Backend:**
- Migration `20260507000014_create_colaboradores.sql`:
  ```sql
  CREATE TABLE colaboradores (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    nome VARCHAR(255) NOT NULL,
    funcao VARCHAR(100),
    comissao_pct NUMERIC(5,2) DEFAULT 0,
    comissao_fixa NUMERIC(10,2) DEFAULT 0,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ALTER TABLE colaboradores ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "users manage own colaboradores" ON colaboradores FOR ALL USING (user_id = auth.uid());
  ```
- Migration `20260507000015_create_comissoes.sql`:
  ```sql
  CREATE TABLE comissoes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    atendimento_id UUID NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
    colaborador_id UUID NOT NULL REFERENCES colaboradores(id),
    user_id UUID NOT NULL REFERENCES profiles(id),
    valor NUMERIC(10,2) NOT NULL,
    pct_aplicado NUMERIC(5,2),
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ALTER TABLE comissoes ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "users manage own comissoes" ON comissoes FOR ALL USING (user_id = auth.uid());
  ```
- Criar `src/services/colaboradorService.js` com CRUD e cálculo de comissão por período
- Endpoints em `dashboard.routes.js`:
  ```
  GET    /api/dashboard/colaboradores
  POST   /api/dashboard/colaboradores
  PUT    /api/dashboard/colaboradores/:id
  DELETE /api/dashboard/colaboradores/:id
  GET    /api/dashboard/colaboradores/:id/comissoes?month=YYYY-MM
  ```
- Atualizar `procedimentoCustoService.getCustoRealProcedimentos()` — incluir comissão média no `custo_total_real`

**Frontend:**
- Página `/dashboard/colaboradores` — lista, cadastro, edição, % de comissão
- Detalhe de custo por procedimento — breakdown: material + taxa cartão + comissão + overhead

**Dependências:** Fase 7 (pró-labore) recomendada antes.

**Definition of Done:**
- Migrations aplicadas
- `procedimentoCustoService` inclui comissão no custo real
- CRUD de colaboradores funcionando
- Testes unitários: mínimo 4 casos cobrindo cálculo com/sem comissão

**Esforço:** M

**Status atual (2026-05-05):**
- **Entregue em backend (parcial forte)**
  - Migrations criadas:
    - `20260507000014_create_colaboradores.sql`
    - `20260507000015_create_comissoes.sql`
  - Serviço `src/services/colaboradorService.js` com:
    - listagem, criação, atualização, remoção
    - consulta de comissões por mês (`month=YYYY-MM`).
  - Endpoints implementados em `dashboard.routes.js`:
    - `GET /api/dashboard/colaboradores`
    - `POST /api/dashboard/colaboradores`
    - `PUT /api/dashboard/colaboradores/:id`
    - `DELETE /api/dashboard/colaboradores/:id`
    - `GET /api/dashboard/colaboradores/:id/comissoes?month=YYYY-MM`
  - `procedimentoCustoService.getCustoRealProcedimentos()` atualizado para:
    - incorporar `comissao_media` por procedimento
    - incluir comissão no `custo_total_real`.
- **Testes backend**
  - `tests/unit/colaboradorService.test.js` criado.
  - `tests/unit/procedimentoCustoService.test.js` criado com 4 cenários de comissão/custos.
- **Deploy / ops**
  - Migrations aplicáveis ao remoto via fluxo documentado acima (fetch + push com `--include-all` quando necessário).
- **Frontend (2026-05-05)**
  - `/dashboard/colaboradores` (CRUD + comissões por mês em painel lateral); Custo Real com coluna comissão média e custo total real; `dashboard-api` + hooks TanStack.

---

## Fase 9 — Estados Empty/Sparse na UI

**Objetivo:** substituir dashboards zerados por guias de ação para novos usuários.

**Impacto de negócio:** sem empty states, novos usuários chegam numa tela vazia sem saber o que fazer — principal causa de churn no onboarding.

**Frontend:**
- Componente reutilizável `EmptyState.tsx`:
  ```tsx
  // props: icon, title, description, ctaLabel, ctaHref
  ```
- Aplicar em todas as páginas quando `data.length === 0` ou `receita === 0`:
  - Dashboard home → "Registre sua primeira venda pelo WhatsApp"
  - Cashflow → "Adicione lançamentos para ver a projeção"
  - Estoque → "Cadastre seus produtos para controlar o estoque"
  - Inadimplência → "Nenhuma parcela em atraso — ótimo sinal!"
  - Pricing → "Registre atendimentos para calcular o custo real"
  - Sazonalidade → "Você precisa de pelo menos 2 meses de dados"
- Estado **Sparse** (< 30 dias de dados):
  - Componente `SparseWarning.tsx` — banner amarelo discreto
  - Esconder comparativos mensais e insights que precisam de histórico
  - Exibir "Dados insuficientes para comparativo — disponível após 30 dias"

**Backend:** nenhum.

**Dependências:** Fase 10 (páginas existindo antes de adicionar empty states nelas).

**Definition of Done:**
- Nenhuma página exibe gráfico/tabela zerado sem mensagem orientadora
- Estado sparse detectado e sinalizado
- Testado com conta sem dados

**Esforço:** P

**Status backend (2026-05-05):**
- Não requer implementação nova em backend.
- Contrato já estável para os estados de empty/sparse consumirem respostas vazias/curtas sem erro.
- Suporte ativo: validação de smoke de rotas durante a execução do frontend.

**Status frontend (2026-05-05):**
- `EmptyState` reutilizável padronizado com `icon`, `title`, `description`, `ctaLabel`, `ctaHref`.
- `SparseWarning` adicionado e aplicado em telas alvo.
- Empty/Sparse aplicado em: home dashboard, cashflow, estoque, inadimplência, pricing/custo real, sazonalidade.
- Em sparse, comparativos sensíveis ao histórico foram reduzidos/ocultados com orientação ao usuário.

---

## Fase 10 — Frontend Phases 4–6 (páginas faltando)

**Objetivo:** criar telas para todos os endpoints de backend já implementados que ainda não têm página no frontend.

**Impacto de negócio:** backend completo sem tela é feature invisível para o usuário.

**Contexto:** verificar `lumiz-financeiro/implementacao2FRONTEND.md` antes — algumas páginas podem já ter sido criadas. Implementar apenas o que estiver faltando.

**Frontend — páginas a verificar/criar:**

| Página | Rota | Endpoint principal |
|---|---|---|
| Estoque (Status/Alertas/Sugestões) | `/dashboard/estoque` | `GET /estoque` |
| NF / Validade | `/dashboard/nf-validade` | `GET /nf-validade` |
| Inadimplência | `/dashboard/inadimplencia` | `GET /inadimplencia/overview` |
| Sazonalidade | `/dashboard/sazonalidade` | `GET /insights/sazonalidade` |
| Health Score (card na home) | home | `GET /health/score` |
| Custo Real por Procedimento | `/dashboard/custo-procedimentos` | `GET /insights/custo-procedimentos` |
| Emergency Detalhes (drawer) | home | `GET /emergency/detalhes` |
| Outlook / Projeção multi-mês | `/dashboard/outlook` | `GET /insights/outlook` |
| Perfil de pagamento por cliente | `/dashboard/clientes` | `GET /clientes/perfil-pagamento` |
| Margem comparativa | `/dashboard/insights` | `GET /insights/margem-comparativa` |

**Tipos TypeScript:** verificar `dashboard-api.ts` — adicionar apenas os que faltarem.

**Backend:** nenhum (tudo já implementado).

**Dependências:** nenhuma de backend.

**Definition of Done:**
- Todas as páginas listadas existem e consomem os endpoints
- `npx tsc --noEmit` sem erros
- `npm run build` sem erros
- Sidebar atualizado com itens novos

**Esforço:** G

**Status backend (2026-05-05):**
- Endpoints listados na fase já disponíveis no backend atual.
- Sem bloqueio de schema para consumo frontend (incluindo entregas de Fases 7–8 já migradas).
- Pendência principal desta fase está no frontend (páginas/rotas/estados/integração).

**Status frontend (2026-05-05):**
- Rotas e telas cobertas: `/dashboard/estoque`, `/dashboard/nf-validade`, `/dashboard/inadimplencia`, `/dashboard/sazonalidade`, `/dashboard/outlook`, `/dashboard/custo-procedimentos`, `/dashboard/clientes`, `/dashboard/insights`.
- Home com integrações ativas de `health/score` e drawer de `emergency/detalhes`.
- `dashboard-api.ts` atualizado com contratos faltantes (`clientes/perfil-pagamento`, `insights/margem-comparativa`) e hooks React Query dedicados.
- Sidebar atualizado para navegação completa das rotas analíticas novas.

---

## Fase 11 — Capture Agent: confidence score + confirmação

**Objetivo:** adicionar confidence score ao parsing de mensagens WhatsApp e solicitar confirmação humana quando score < 0.8.

**Impacto de negócio:** qualidade do dado de entrada define a qualidade de todos os relatórios. Erro no registro de venda corrompe margem, fluxo de caixa e health score.

**Backend:**
- Atualizar `buildIntentClassificationPrompt()` e `buildDocumentExtractionPrompt()` em `src/config/prompts.js` — instruir o modelo a retornar `confidence_score` (0.0–1.0) por campo extraído
- Em `src/controllers/messages/transactionHandler.js`:
  - Se `confidence_score < 0.8` em campo crítico (valor, paciente, procedimento): salvar rascunho em `conversationRuntimeStateService` com `stage: 'awaiting_confidence_confirm'`
  - Enviar card de confirmação via WhatsApp: "Entendi: *[resumo]*. Está correto? Responda SIM ou corrija."
  - Fluxo de confirmação: SIM → salva; correção → re-parsear; CANCELAR → descarta
- Criar copy em `src/copy/captureConfirmWhatsappCopy.js`:
  - `cardConfirmacao(dados)` — mensagem estruturada com os campos extraídos
  - `confirmacaoCancelada()` — lançamento descartado
- Métricas: logar `confidence_score` médio por campo em `analytics_events`

**Frontend:** nenhum (fluxo 100% WhatsApp).

**Dependências:** nenhuma.

**Definition of Done:**
- Mensagens com valor ambíguo geram card de confirmação no WhatsApp
- Fluxo SIM/correção/cancelar funciona end-to-end
- `confidence_score` logado em `analytics_events`
- Teste manual com mensagem ambígua ("vendi hoje 850 botox")

**Esforço:** M

**Status atual (Onda 1 do plano backend completo, 2026-05-07):**
- **Backend entregue**
  - `src/services/audioTranscriptionService.js` — wrapper Whisper para áudio do WhatsApp (OGG/MP3/M4A); webhook em `src/routes/webhook.js` agora trata `audioMessage` → transcreve → injeta no fluxo de texto comum.
  - `buildIntentClassificationPrompt()` e `buildDocumentExtractionPrompt()` agora retornam `confidence_score: 0..1` (alias `confianca` mantido para compatibilidade) com guidelines explícitas por faixa de confiança.
  - `src/copy/captureConfirmCopy.js` — `isLowConfidence()` (threshold configurável via `CAPTURE_LOW_CONFIDENCE_THRESHOLD`, padrão 0.8) + `lowConfidenceBanner()`.
  - `transactionHandler.handleTransactionRequest()` carrega `confidence_score` no pending; `buildConfirmationMessage()` insere banner "Não tenho 100% de certeza, confere por favor:" quando score < threshold.
  - `documentHandler` aplica o mesmo banner em respostas de OCR (NF, boleto, comprovante) via helper `_prefixLowConfidence()`.
  - Dependência `openai` adicionada em `package.json` (estava sendo usada em `openaiService.js` sem estar declarada).
- **Testes**
  - `tests/unit/audioTranscriptionService.test.js` (4 casos — sem chamar API real).
  - `tests/unit/captureConfirmFlow.test.js` (7 casos — copy + comportamento do banner em buildConfirmationMessage).

---

## Fase 12 — Importador de planilha Excel

**Objetivo:** permitir que a clínica faça upload de seu Excel histórico e importe lançamentos automaticamente.

**Impacto de negócio:** "sem importador, perdemos 60% das clínicas que tentam o produto" (handoff, parte 7.1). A biblioteca `xlsx` já está no projeto e `excelService.js` já gera Excel — só falta o fluxo inverso.

**Backend:**
- Atualizar `src/services/excelService.js` — adicionar método `importFromExcel(userId, buffer)`:
  - Ler todas as abas do workbook
  - Heurística de mapeamento automático: detectar colunas "Receita", "Despesa", "Data", "Valor", "Cliente", "Forma Pagamento" (case-insensitive, partial match)
  - Retornar `{ preview: [...], mapeamento: {...}, inconsistencias: [...] }` antes de salvar
  - Após confirmação: salvar em `atendimentos` (entradas) e `contas_pagar` (saídas) com `source: 'import'`
  - Tag de batch: `import_batch_id` (UUID) em cada registro importado para permitir desfazer
- Novos endpoints em `dashboard.routes.js`:
  ```
  POST /api/dashboard/import/excel/preview   → multipart, retorna preview sem salvar
  POST /api/dashboard/import/excel/confirm   → body: { import_token }, salva de fato
  DELETE /api/dashboard/import/excel/:batchId → desfaz importação inteira
  GET  /api/dashboard/import/excel/history   → lista importações anteriores
  ```
- Validações: valor numérico positivo, data válida, forma de pagamento mapeável

**Frontend:**
- Página `/dashboard/import`:
  - Step 1: upload de arquivo `.xlsx` ou `.xls` com drag-and-drop
  - Step 2: preview dos primeiros 10 registros + mapeamento de colunas editável
  - Step 3: confirmar importação + barra de progresso
  - Step 4: resumo — "importei X lançamentos · R$ Y em receita · Z inconsistências"
  - Botão "Desfazer importação" disponível por 24h

**Dependências:** nenhuma crítica. Fases 7–8 recomendadas antes (pró-labore e comissão evitam retrabalho no import).

**Definition of Done:**
- Upload de Excel com colunas padrão importa sem erro
- Preview correto antes de confirmar
- Desfazer batch remove todos os registros do import
- Notificação WhatsApp ao final: "Importei X lançamentos"
- Teste com o `Controle Geral.xlsx` da NB Clinic

**Esforço:** G

---

## Fase 13 — Export OFX para contador

**Objetivo:** adicionar formato OFX ao export existente para compatibilidade com software contábil.

**Impacto de negócio:** o contador da clínica pede extrato todo mês. Se a Lumiz exportar no formato certo, o contador vira aliado e indica clientes. `exportService.js` já tem PDF e CSV — OFX é pequena adição.

**Backend:**
- Adicionar método `exportOFX(userId, monthStr)` em `src/services/exportService.js`:
  - Formato OFX 2.0 (XML) com `<STMTTRN>` por transação
  - Campos: `<TRNTYPE>` (CREDIT/DEBIT), `<DTPOSTED>`, `<TRNAMT>`, `<FITID>` (id único), `<NAME>` (descrição), `<MEMO>` (categoria)
  - Encoding UTF-8 com BOM para compatibilidade com Excel/Sage
- Atualizar endpoint `GET /api/dashboard/export/report`:
  - Aceitar `format=ofx`
  - `Content-Type: application/x-ofx`
  - `Content-Disposition: attachment; filename="extrato-YYYY-MM.ofx"`

**Frontend:**
- Atualizar `ExportButtons.tsx` — adicionar botão "OFX (Contador)"
- Mesmo padrão dos botões PDF/CSV existentes

**Dependências:** nenhuma.

**Definition of Done:**
- Arquivo `.ofx` gerado abre no Excel e em software contábil (testar no Conta Azul ou similar)
- Saldo do OFX bate com o CSV do mesmo período
- Botão OFX visível no dashboard

**Esforço:** P

---

## Fase 14 — Multi-tenant / switch de clínica

**Objetivo:** permitir que uma sócia com múltiplas clínicas alterne entre elas no dashboard sem trocar de conta.

**Impacto de negócio:** caso comum de expansão de rede. `clinic_members` e `clinicMemberService.js` já existem — falta o contexto de "clínica ativa" nas requisições do dashboard.

**Backend:**
- Criar middleware `resolveClinicContext(req, res, next)` em `src/middleware/`:
  - Lê header `X-Clinic-Id` ou query param `clinic_id`
  - Valida que `req.user.id` é membro ativo da clínica solicitada via `clinic_members`
  - Seta `req.clinic_id` para uso nas queries
  - Se ausente: usa `clinic_id` padrão (clínica principal do usuário)
- Aplicar middleware em `dashboard.routes.js` após `authenticateFlexible`
- Novos endpoints:
  ```
  GET  /api/user/clinics         → lista clínicas do usuário autenticado
  POST /api/user/switch-clinic   → body: { clinic_id }, retorna novo contexto
  ```
- Atualizar queries de dashboard para usar `req.clinic_id` em vez de `req.user.id` onde aplicável

**Frontend:**
- Seletor de clínica no topbar/sidebar (só exibir se usuário tiver > 1 clínica)
- Após troca: invalidar cache do React Query e recarregar dashboard
- Persistir clínica selecionada em `localStorage`

**Dependências:** nenhuma crítica.

**Definition of Done:**
- Usuário com 2 clínicas consegue alternar e ver dados isolados
- Queries retornam apenas dados da clínica ativa
- Teste: criar 2 clínicas, registrar venda em cada uma, confirmar isolamento

**Esforço:** G

---

## Fase 15 — Audit log

**Objetivo:** registrar toda mutation crítica para rastreabilidade e debugging em produção.

**Impacto de negócio:** quando a Nathalia disser "não fui eu que deletei esse lançamento", o audit log resolve. Também cobre requisitos de compliance (LGPD parte 6.6 do handoff).

**Backend:**
- Migration `20260507000016_create_audit_log.sql`:
  ```sql
  CREATE TABLE audit_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    clinic_id UUID,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    old_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at DESC);
  CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
  ```
- Criar `src/services/auditLogService.js`:
  - `log(userId, action, entityType, entityId, oldValue, newValue)`
  - Ações chave: `transaction_created`, `transaction_deleted`, `goal_updated`, `import_confirmed`, `import_undone`, `conta_pagar_updated`, `estoque_entrada`
- Integrar nas rotas críticas do `dashboard.routes.js` (POST/PUT/DELETE)
- Endpoint:
  ```
  GET /api/dashboard/audit-log?limit=50&entity_type=transaction
  ```

**Frontend:**
- Página `/dashboard/configuracoes/audit-log` (acesso admin)
- Tabela com: data, ação, entidade, usuário, antes/depois (expandível)

**Dependências:** Fase 14 (multi-tenant) recomendada — audit log deve incluir `clinic_id`.

**Definition of Done:**
- Criar/editar/deletar transação gera registro no audit log
- Endpoint retorna log paginado
- Página de audit log acessível nas configurações

**Esforço:** M

---

## Fase 16 — Feature flags

**Status:** 🟡 Concluído (backend) — frontend (hook `useFeatureFlag`) pendente. Entregue via Onda 3.A do plano `backend_completo_financeiro_alter_whatsapp`.

**Objetivo:** permitir ativar/desativar features por ambiente ou por clínica sem redeploy.

**Impacto de negócio:** viabiliza rollout gradual das próximas fases (5% → 25% → 100%) e kill switch rápido se algo der errado.

**Backend:** ✅
- `src/services/featureFlagService.js`: layered resolver (DB user → DB global → env JSON → env booleano → default false). Cache 60s.
- Migration `supabase/migrations/20260507000030_create_feature_flags.sql`: tabela `feature_flags(user_id, name, enabled, meta)` + RLS.
- Middleware `requireFeature(flag)` exposto via `featureFlagService.requireFeature` — usado em todas as rotas Alter (`/api/dashboard/alter/*`).
- Endpoint `GET /api/config/features`: pendente (consumo direto do service em rotas + middleware atende o caso atual).

**Frontend:** ⬜
- Hook `useFeatureFlag(flagName: string): boolean` consumindo o endpoint
- Guard em componentes novos: `{useFeatureFlag('excel_import') && <ImportButton />}`

**Dependências:** nenhuma.

**Definition of Done:**
- Flag `excel_import: false` esconde o botão de import no frontend
- Flag `multi_tenant: true` exibe seletor de clínica
- Adicionar flag nova não requer deploy de código

**Esforço:** P

---

## Fase 17 — Analytics de produto (PostHog)

**Objetivo:** instrumentar o produto com analytics real para decisões baseadas em uso.

**Impacto de negócio:** sem dados de uso, não sabemos onde usuários travam, quais features geram valor, qual o TTFV real. North star: lançamentos por clínica por semana.

**Backend:**
- Instalar `posthog-node`
- Criar `src/services/posthogService.js`:
  - `track(userId, event, properties)` — wraper com fallback graceful se `POSTHOG_API_KEY` ausente
  - `identify(userId, traits)` — envia perfil da clínica
- Adicionar `POSTHOG_API_KEY` e `POSTHOG_HOST` em `src/config/env.js` como opcionais
- Enriquecer `analyticsService.js` para enviar para PostHog além do Supabase:
  - `transaction_created`, `report_exported`, `goal_set`, `simulator_run`, `excel_imported`, `emergency_triggered`, `onboarding_completed`

**Frontend:**
- Instalar `posthog-js`
- Inicializar em `main.tsx` com `VITE_POSTHOG_API_KEY`
- `identify` após login com `userId`, `clinicName`, `tier`
- Pageview automático por rota
- Track manual em ações chave: exportar, simular, registrar estoque

**Dependências:** nenhuma.

**Definition of Done:**
- Dashboard PostHog mostra eventos reais de uso
- Funil de onboarding visível (steps até primeiro lançamento)
- `POSTHOG_API_KEY` ausente não quebra nada (graceful degradation)

**Esforço:** M

---

## Fase 18 — MFA obrigatório

**Objetivo:** exigir segundo fator de autenticação para usuários owner com dados financeiros sensíveis.

**Impacto de negócio:** dados financeiros de clínica são sensíveis (LGPD + risco de negócio). MFA reduz drasticamente risco de acesso não autorizado.

**Backend:**
- Supabase Auth suporta TOTP nativamente — usar API existente
- Criar middleware `requireMFA(req, res, next)`:
  - Verificar campo `amr` (authentication method reference) no JWT do Supabase
  - Se usuário é `owner` e não tem TOTP verificado na sessão: retornar `403 MFA_REQUIRED`
  - Grace period: 7 dias após criação da conta (novo usuário não é bloqueado imediatamente)
- Endpoints:
  ```
  POST /api/auth/mfa/enroll   → inicia enrollment TOTP (retorna QR code)
  POST /api/auth/mfa/verify   → verifica código TOTP
  DELETE /api/auth/mfa        → remove TOTP (requer senha)
  ```

**Frontend:**
- Flow de enrollment em `/configuracoes/seguranca`:
  - Botão "Ativar autenticação de dois fatores"
  - QR code para escanear no Google Authenticator / Authy
  - Campo de verificação do código antes de confirmar
- Challenge na sessão quando necessário (redirect para `/mfa/challenge`)
- Badge "MFA ativo" nas configurações

**Dependências:** nenhuma técnica. Fase 17 (analytics) recomendada para medir adoção.

**Definition of Done:**
- Usuário owner sem MFA vê banner de aviso por 7 dias, depois é bloqueado
- Enrollment funciona end-to-end com TOTP
- Teste: remoção de MFA exige confirmação de senha

**Esforço:** M

---

## Fase 19 — LGPD: export de dados + direito ao esquecimento

**Objetivo:** implementar export completo de dados do usuário e fluxo de exclusão de conta conforme LGPD.

**Impacto de negócio:** obrigação legal. Sem isso, o produto não pode receber o primeiro pagamento com segurança jurídica. Prazo legal: 15 dias para atender solicitação.

**Backend:**
- Criar `src/services/lgpdService.js`:
  - `exportUserData(userId)`:
    - Dump completo de todas as tabelas do usuário (`atendimentos`, `contas_pagar`, `parcelas`, `clientes`, `procedimentos`, `estoque`, `metas`, `audit_log`, `reminders_sent`)
    - Formato JSON estruturado por entidade
    - Enviar por email via `emailReportService` (Resend já integrado)
    - Retornar também como download direto
  - `deleteUserData(userId)`:
    - Cascade delete de dados operacionais
    - Anonimizar `audit_log` (substituir `user_id` por hash, manter registros por 5 anos — obrigação fiscal)
    - Cancelar subscription ativa
    - Desativar profile (`is_active = false`, `deactivated_at = now()`)
    - NÃO deletar dados financeiros com obrigação fiscal de 5 anos (manter anonimizados)
- Endpoints:
  ```
  GET    /api/user/export-data    → gera export e envia por email
  DELETE /api/user/account        → solicita exclusão (requer confirmação por email)
  POST   /api/user/account/confirm-delete  → confirma exclusão após email
  ```

**Frontend:**
- Seção "Privacidade e dados" em `/configuracoes`:
  - Botão "Exportar meus dados" — feedback: "você receberá um email em até 24h"
  - Botão "Excluir conta" — modal de confirmação com campo de texto "EXCLUIR" + aviso sobre dados fiscais

**Dependências:** Fase 15 (audit log) — necessário para anonimização correta.

**Definition of Done:**
- Export gera JSON com todas as entidades do usuário e envia por email
- Exclusão anonimiza audit log e desativa conta
- Dados com obrigação fiscal permanecem anonimizados por 5 anos
- Fluxo de exclusão exige confirmação dupla (modal + email)

**Esforço:** M

---

## Fase 20 — Integrações futuras

**Objetivo:** conectar a Lumiz com parceiros externos para dados em tempo real.

**Status:** Bloqueado — depende de contratos, homologações e decisões estratégicas externas.

**Decisão urgente (Apêndice C do handoff):**
1. Alter é parceiro externo via API ou módulo interno?
2. Provider de WhatsApp Business confirmado (Twilio / 360dialog / Z-API)?
3. Open Finance: Pluggy ou Belvo?

### 20.1 Pluggy — Open Finance

- `src/services/pluggyService.js` — sync de transações bancárias da conta PJ
- Webhook de transações: reconciliação automática com `contas_pagar`
- Detecção de cartão de crédito PJ (R$ 7-10k/mês na NB Clinic)
- **Custo:** R$ 1,50–3,00/conta/mês

### 20.2 Adquirentes (Stone / Itaú / Cielo)

- `src/services/adquirenteService.js` — feed automático de vendas por maquininha
- Reconciliação com `atendimentos` (evitar lançamento duplicado)
- Sync de taxas MDR reais (substituir configuração manual)

### 20.3 NFe.io — Emissão de NF

- `src/services/nfeService.js` — emissão de NFS-e vinculada a atendimento
- Endpoint: `POST /api/dashboard/atendimentos/:id/emitir-nf`
- **Custo:** R$ 0,49/nota

### 20.4 Alter — Motor de recebíveis

**Status:** 🟡 Backend mock pronto via Onda 3 (A/B/C). Falta sandbox/contrato real da Alter para destravar o `realAlterAdapter`.

**Concluído (backend):**
- Adapter contract + factory: `src/services/alter/{alterAdapterContract,alterAdapter,mockAlterAdapter,realAlterAdapter}.js`. Factory escolhe automaticamente entre mock e real conforme `ALTER_API_URL` + `ALTER_API_KEY`.
- Domínio: `alterRecebiveisService` (aging/posição/mix), `antecipacaoService` (simular/executar/recomendar/parar-automática), `coberturaFornecedorService` (cobertura por fornecedor + snapshots), `pagarComRecebivelService` (sugerir/executar pagamento via recebível).
- Schema: migrations `20260507000031..033` (`alter_recebiveis`, `alter_antecipacoes`, `alter_cobertura_snapshots`).
- Endpoints `/api/dashboard/alter/*` atrás de `requireFeature('alter_enabled')`.
- Health score componente `cobertura_fornecedor` (peso configurável via `HEALTH_SCORE_COBERTURA_FORNECEDOR_PESO`).
- Cron semanal `/api/cron/alter-insights` via `alterInsightCronService` + copy `src/copy/alterWhatsappCopy.js`.

**Pendente (real):**
- Implementar métodos de `realAlterAdapter.js` consumindo `ALTER_API_URL`/`ALTER_API_KEY`.
- Score de crédito da clínica (depende de dados Alter).
- Frontend Alter (telas dedicadas).

**Definition of Done para go-live real:**
- Contrato API Alter assinado e sandbox disponível.
- `realAlterAdapter` implementado e validado contra sandbox.
- Frontend consumindo endpoints `/api/dashboard/alter/*`.
- Flag `alter_enabled` ligada gradualmente (5% → 25% → 100%).

**Esforço:** G (cada sub-fase)

---

## Princípios de execução

1. **Determinístico primeiro, LLM depois** — cálculos financeiros nunca passam por LLM. LLM só extrai parâmetros e gera prose.
2. **Fases pequenas e commitáveis** — cada fase deve gerar um commit funcional sem quebrar o que já existe.
3. **Testes antes de avançar** — `npm run test:regression` deve passar após cada fase backend.
4. **TypeScript sem `any`** — `npx tsc --noEmit` deve passar após cada fase frontend.
5. **Migrations versionadas** — seguir padrão `YYYYMMDD000XXX_nome.sql`.
6. **Commits com GPG desativado** — `git -c commit.gpgsign=false commit`.

---

*Documento vivo. Versão 1.0 · Maio/2026. Atualizar status após cada entrega.*
