# Lumiz Backend - Assistente Financeiro via WhatsApp

Backend completo para assistente financeiro via WhatsApp usando Evolution API, Gemini AI e Supabase.

## Tecnologias

- Node.js + Express
- Evolution API (WhatsApp)
- Google Gemini AI (processamento de linguagem natural)
- Supabase (banco de dados PostgreSQL)

## Estrutura do Projeto

```
lumiz-backend/
├── src/
│   ├── controllers/
│   │   ├── messageController.js      # Controlador principal de mensagens
│   │   ├── transactionController.js  # Gerenciamento de transações
│   │   └── userController.js         # Gerenciamento de usuários
│   ├── db/
│   │   ├── supabase.js              # Configuração do Supabase
│   │   └── schema.sql               # Schema do banco de dados
│   ├── routes/
│   │   └── webhook.js               # Rotas do webhook e teste
│   ├── services/
│   │   ├── evolutionService.js      # Integração com Evolution API
│   │   └── geminiService.js         # Integração com Gemini AI
│   └── server.js                    # Servidor principal
├── .env                             # Variáveis de ambiente
├── .env.example                     # Exemplo de variáveis
├── .gitignore
├── package.json
└── README.md
```

## Configuração Inicial

### 1. Obter API Key do Gemini

1. Acesse: https://aistudio.google.com/app/apikey
2. Crie uma nova API key
3. Copie a chave gerada

### 2. Configurar variáveis de ambiente

Edite o arquivo `.env` e adicione sua chave do Gemini:

```env
GEMINI_API_KEY=sua_chave_aqui
```

As demais variáveis já estão configuradas no arquivo `.env`.

### 3. Configurar banco de dados no Supabase

1. Acesse: https://supabase.com/dashboard/project/whmbyfnwnlbrfmgdwdfw/sql/new
2. Copie todo o conteúdo do arquivo `src/db/schema.sql`
3. Cole no SQL Editor do Supabase
4. Execute o script (botão "Run")

### 4. Instalar dependências

```bash
npm install
```

### 5. Iniciar o servidor

Modo desenvolvimento (com auto-reload):
```bash
npm run dev
```

Modo produção:
```bash
npm start
```

## Testando a aplicação

### Teste local via API

```bash
curl -X POST http://localhost:3000/api/test \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5511999999999",
    "message": "gastei 50 no mercado"
  }'
```

### Exemplos de mensagens

**Registrar despesa:**
- "gastei 50 no mercado"
- "paguei 30 de uber"
- "comprei 100 de roupas"

**Registrar receita:**
- "recebi 1500 de salário"
- "ganhei 200 de freelance"
- "recebi 50 de investimento"

**Consultas:**
- "qual meu saldo?"
- "mostra meu histórico"
- "relatório do mês"
- "minhas últimas transações"

**Ajuda:**
- "olá"
- "ajuda"
- "oi"

## Endpoints da API

### `POST /api/webhook`
Webhook para receber mensagens da Evolution API.

### `POST /api/test`
Endpoint para testes locais.

Payload:
```json
{
  "phone": "5511999999999",
  "message": "sua mensagem aqui"
}
```

### `GET /health`
Verifica status do servidor.

### `GET /`
Informações sobre a API.

## Onboarding Inteligente

O backend agora possui um módulo completo de onboarding composto por três fases:

- **Fase 1** – coleta gamificada dos dados principais (nome, clínica, email, CNPJ opcional, tamanho da equipe e volume mensal) com salvamento em tempo real.
- **Fase 2** – configuração das taxas MDR, permitindo cadastro manual ou envio de prints/prints para OCR (Stone, PagSeguro, Rede, Cielo, GetNet, Mercado Pago).
- **Fase 3** – geração de prompts contextuais para o assistente WhatsApp e conclusão do fluxo.

### Endpoints principais

- `GET /api/onboarding/state` – obtém ou inicia o progresso (usa `x-user-phone`).
- `PATCH /api/onboarding/state` – atualiza estágio/dados do onboarding.
- `POST /api/onboarding/steps` – marca passos como concluídos ou pulados.
- `POST /api/onboarding/mdr/manual` – registra taxas manualmente.
- `POST /api/onboarding/mdr/ocr` – processa print com OCR e extrai taxas automaticamente.
- `GET /api/onboarding/assistant/prompts` – sugere prompts contextuais para o bot.
- `GET /api/onboarding/metrics` – métricas agregadas (taxa de conclusão, tempo médio, adoção MDR, NPS).
- Cron `/api/cron/reminders` – dispara lembretes de parcelas, nudges de onboarding e insights diários via Gemini.

Todas as respostas retornam o progresso atual (`progress_label`) permitindo retomar exatamente onde o usuário parou.

### Dashboard + RLS no Supabase

- As tabelas `transactions`, `categories`, `onboarding_progress`, `mdr_configs` e `ocr_jobs` têm Row Level Security habilitado (`user_id = auth.uid()`), permitindo que o frontend consulte direto o Supabase usando apenas o `anon key`.
- Quando o token não estiver disponível (ex.: sessão expirada), o frontend pode usar os endpoints REST (`/api/dashboard/*`) com o JWT do Supabase Auth — o middleware `authenticateFlexible` já suporta ambos os cenários.
- Variáveis necessárias no frontend (Vercel/Vite): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY` (opcional) e `VITE_API_URL` apontando para este backend.

## Funcionalidades

### Processamento de Linguagem Natural
O Gemini AI identifica automaticamente:
- Tipo de transação (entrada/saída)
- Valor
- Categoria
- Descrição
- Data (usa data atual se não especificada)

### Gerenciamento de Transações
- Registro de receitas e despesas
- Categorização automática
- Histórico completo
- Relatórios mensais

### Categorias Padrão
Criadas automaticamente para novos usuários:
- **Entradas:** Salário, Freelance, Investimento
- **Saídas:** Alimentação, Transporte, Moradia, Lazer, Saúde, Educação, Outros

### Insights Automatizados
- Worker diário analisa KPIs de cada clínica, gera insights com Gemini e salva na tabela `user_insights`.
- O bot envia o resumo pelo WhatsApp e o usuário pode solicitar a qualquer momento com o comando `insights`.

## Estrutura do Banco de Dados

### Tabela `users`
- `id`: UUID
- `phone`: VARCHAR(20) - Número do WhatsApp
- `name`: VARCHAR(100) - Nome do usuário
- `created_at`: TIMESTAMP
- `updated_at`: TIMESTAMP

### Tabela `categories`
- `id`: UUID
- `user_id`: UUID (FK)
- `name`: VARCHAR(50)
- `type`: VARCHAR(10) - 'entrada' ou 'saida'
- `created_at`: TIMESTAMP

### Tabela `transactions`
- `id`: UUID
- `user_id`: UUID (FK)
- `category_id`: UUID (FK)
- `type`: VARCHAR(10) - 'entrada' ou 'saida'
- `amount`: DECIMAL(10, 2)
- `description`: TEXT
- `date`: DATE
- `created_at`: TIMESTAMP
- `updated_at`: TIMESTAMP

## Variáveis de Ambiente

```env
# Evolution API
EVOLUTION_API_URL=https://evolution.guerrizeeg.com.br
EVOLUTION_API_KEY=sua_chave
EVOLUTION_INSTANCE_NAME=nome_instancia

# Supabase
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua_chave_anon
SUPABASE_SERVICE_ROLE_KEY=sua_chave_service

# Gemini AI
GEMINI_API_KEY=sua_chave_gemini

# Servidor
PORT=3000
NODE_ENV=development
```

## Troubleshooting

### Erro ao conectar com Supabase
- Verifique se as credenciais no `.env` estão corretas
- Confirme que o schema SQL foi executado

### Erro ao processar mensagens
- Verifique se a API key do Gemini está configurada
- Confirme que o modelo `gemini-2.0-flash-exp` está disponível

### Erro ao enviar mensagens
- Verifique as credenciais da Evolution API
- Confirme que a instância está conectada

## Próximos Passos

1. Configurar webhook na Evolution API apontando para `/api/webhook`
2. Testar fluxo completo via WhatsApp
3. Monitorar logs do servidor
4. Ajustar prompts do Gemini conforme necessário

## Suporte

Para problemas ou dúvidas, verifique:
- Logs do servidor (terminal)
- Status do Supabase
- Status da Evolution API
- Quota da API do Gemini
