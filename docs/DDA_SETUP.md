# Configuração DDA (Débito Direto Autorizado)

## O que é DDA?

DDA permite consultar boletos automaticamente via APIs bancárias, sem precisar acessar o internet banking manualmente.

## Como Funciona

1. **Consulta Automática**: O sistema consulta boletos pendentes via API do banco
2. **Registro Automático**: Boletos encontrados são registrados como "contas a pagar"
3. **Notificação**: Usuário recebe notificação no WhatsApp com os novos boletos

## Opções Disponíveis

### 1. Banco Central - Open Banking (Recomendado)
- **Vantagens**: Padrão oficial, funciona com qualquer banco
- **Desvantagens**: Requer certificado digital A1, integração complexa
- **Documentação**: https://www.bcb.gov.br/estabilidadefinanceira/openbanking

### 2. APIs Bancárias Específicas
- **Bradesco**: https://developers.bradesco.com.br/
- **Itaú**: https://developer.itau.com.br/
- **Santander**: https://developers.santander.com.br/

### 3. Serviços Terceiros
- **Gerencianet (Efí)**: https://dev.gerencianet.com.br/
- **Asaas**: https://docs.asaas.com/
- **PagSeguro**: https://dev.pagseguro.uol.com.br/

## Configuração

### Variáveis de Ambiente

```env
# Provedor DDA (bradesco, itau, gerencianet, etc)
DDA_PROVIDER=bradesco

# Credenciais da API
DDA_API_KEY=sua_api_key
DDA_API_SECRET=sua_api_secret

# URL da API (se necessário)
DDA_API_URL=https://api.bradesco.com.br
```

### Ativar DDA para um Usuário

No banco de dados, atualize o perfil do usuário:

```sql
UPDATE profiles 
SET dda_ativo = true 
WHERE id = 'user_id';
```

Ou via WhatsApp, o usuário pode pedir:
- "Ativar DDA"
- "Quero receber boletos automaticamente"

## Migração do Banco de Dados

Execute no Supabase:

```sql
-- Adiciona campo para ativar/desativar DDA
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS dda_ativo BOOLEAN DEFAULT false;

-- Adiciona campos na tabela contas_pagar para DDA
ALTER TABLE contas_pagar 
ADD COLUMN IF NOT EXISTS codigo_barras VARCHAR(100),
ADD COLUMN IF NOT EXISTS origem VARCHAR(20) DEFAULT 'manual';

-- Índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_contas_pagar_codigo_barras 
ON contas_pagar(codigo_barras);
```

## Implementação por Provedor

Cada provedor tem sua própria implementação no arquivo `src/services/ddaService.js`:

- `consultarBradesco()` - API Bradesco
- `consultarItau()` - API Itaú
- `consultarGerencianet()` - Gerencianet

## Cron Job

O DDA é executado automaticamente via cron job:

```
GET /api/cron/reminders?secret=SEU_SECRET
```

Configurar no seu serviço de cron (ex: Railway Cron, Vercel Cron):

```
0 9 * * * curl https://seu-backend.railway.app/api/cron/reminders?secret=SEU_SECRET
```

## Limitações

1. **Certificado Digital**: Alguns bancos exigem certificado digital A1
2. **OAuth2**: Open Banking requer fluxo de autenticação OAuth2
3. **Rate Limits**: APIs têm limites de requisições por minuto/hora
4. **Custos**: Alguns provedores cobram por consulta

## Próximos Passos

1. Escolher um provedor DDA
2. Obter credenciais de API
3. Implementar método específico em `ddaService.js`
4. Testar com usuário de teste
5. Ativar para usuários reais

## Suporte

Para dúvidas sobre integração DDA, consulte a documentação do provedor escolhido ou entre em contato com o suporte técnico.

