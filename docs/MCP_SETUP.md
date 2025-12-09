# Configuração do MCP Server - Lumiz Backend

O MCP (Model Context Protocol) Server permite que assistentes de IA como Claude Desktop consultem e interajam com o banco de dados do Lumiz diretamente.

## 📋 Pré-requisitos

1. ✅ Dependências já instaladas (`@modelcontextprotocol/sdk` está no `package.json`)
2. ✅ Variáveis de ambiente do Supabase configuradas no `.env`:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

## 🔧 Configuração no Supabase

**Não é necessário configurar nada adicional no Supabase!** 

O MCP Server usa as mesmas credenciais que o backend principal:
- `SUPABASE_URL`: URL do seu projeto Supabase
- `SUPABASE_SERVICE_ROLE_KEY`: Chave de serviço (service role key) do Supabase

Essas variáveis já devem estar configuradas no seu `.env` para o backend funcionar.

### Onde encontrar as credenciais:

1. Acesse: https://supabase.com/dashboard/project/whmbyfnwnlbrfmgdwdfw/settings/api
2. Copie:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (secret) → `SUPABASE_SERVICE_ROLE_KEY`

⚠️ **Importante**: Use a `service_role` key (não a `anon` key), pois o MCP precisa de permissões completas para consultar todas as tabelas.

## 🖥️ Configuração no Claude Desktop

### 1. Localizar o arquivo de configuração

**macOS:**
```bash
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux:**
```bash
~/.config/Claude/claude_desktop_config.json
```

### 2. Editar o arquivo de configuração

Adicione o servidor MCP do Lumiz na seção `mcpServers`:

```json
{
  "mcpServers": {
    "lumiz-backend": {
      "command": "node",
      "args": [
        "/caminho/absoluto/para/lumiz-backend/scripts/mcp-server.js"
      ],
      "env": {
        "SUPABASE_URL": "https://seu-projeto.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "sua-service-role-key"
      }
    }
  }
}
```

**Exemplo completo (macOS):**
```json
{
  "mcpServers": {
    "lumiz-backend": {
      "command": "node",
      "args": [
        "/Users/ericguerrize/lumiz-backend/scripts/mcp-server.js"
      ],
      "env": {
        "SUPABASE_URL": "https://whmbyfnwnlbrfmgdwdfw.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "sua-chave-aqui"
      }
    }
  }
}
```

### 3. Reiniciar o Claude Desktop

Após salvar o arquivo, feche e abra novamente o Claude Desktop para carregar a nova configuração.

## 🧪 Testando a Configuração

Após configurar, você pode testar no Claude Desktop perguntando:

- "Busque os últimos 5 usuários do banco"
- "Mostre estatísticas do usuário com telefone 5511999999999"
- "Quantos perfis temos cadastrados?"

## 🛠️ Ferramentas Disponíveis

O MCP Server expõe duas ferramentas:

### 1. `query_database`
Executa queries SQL READ-ONLY no banco de dados.

**Exemplo de uso:**
```
SELECT * FROM profiles LIMIT 5
SELECT * FROM transactions WHERE date >= '2024-01-01'
```

⚠️ **Segurança**: Apenas queries `SELECT` são permitidas.

### 2. `get_user_stats`
Busca estatísticas rápidas de um usuário pelo telefone ou nome.

**Exemplo de uso:**
- Buscar por telefone: `5511999999999`
- Buscar por nome: `João Silva`

## 🔍 Troubleshooting

### Erro: "Cannot find module"
- Verifique se o caminho absoluto está correto
- Certifique-se de que o Node.js está no PATH

### Erro: "SUPABASE_URL is not defined"
- Verifique se as variáveis de ambiente estão no arquivo de configuração do Claude Desktop
- Confirme que os valores estão corretos no `.env` do projeto

### Erro: "Permission denied"
- Execute: `chmod +x scripts/mcp-server.js`
- Verifique permissões do arquivo

### O MCP não aparece no Claude Desktop
- Reinicie completamente o Claude Desktop
- Verifique se o JSON está válido (use um validador JSON online)
- Verifique os logs do Claude Desktop para erros

## 📝 Notas Importantes

1. **Segurança**: O MCP Server usa a `SERVICE_ROLE_KEY`, que tem acesso total ao banco. Mantenha essas credenciais seguras.

2. **Performance**: Queries complexas podem ser lentas. O servidor limita automaticamente a 10 resultados por padrão.

3. **Desenvolvimento**: Para testar o servidor manualmente:
   ```bash
   node scripts/mcp-server.js
   ```

4. **Atualizações**: Se você atualizar o código do MCP Server, reinicie o Claude Desktop para carregar as mudanças.
