# 🔧 Troubleshooting MCP - "Server disconnected"

## ❌ Problema Identificado

O erro "Server disconnected" geralmente ocorre por um destes motivos:

1. **Nome da variável de ambiente incorreto** ⚠️ (SEU CASO)
2. Caminho do Node.js não encontrado
3. Script sem permissão de execução
4. Variáveis de ambiente não carregadas

---

## ✅ Solução para o seu caso

### Problema: Variável de ambiente incorreta

**❌ ERRADO (o que você tem):**
```json
"env": {
    "SUPABASE_URL": "...",
    "SUPABASE_KEY": "..."  // ❌ Nome errado!
}
```

**✅ CORRETO (o que deve ser):**
```json
"env": {
    "SUPABASE_URL": "https://whmbyfnwnlbrfmgdwdfw.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."  // ✅ Nome correto!
}
```

### Passo a passo para corrigir:

1. **Abra o arquivo de configuração do Claude Desktop:**
   ```bash
   open ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```

2. **Substitua `SUPABASE_KEY` por `SUPABASE_SERVICE_ROLE_KEY`**

3. **Sua configuração final deve ficar assim:**
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
                   "SUPABASE_SERVICE_ROLE_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobWJ5Zm53bmxicmZtZ2R3ZGZ3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTkxNzg3MCwiZXhwIjoyMDc3NDkzODcwfQ.7fTwCPv7I6ZasEDAHsQ90MMdjfiPNqy_bvsOk5UwTds"
               }
           }
       }
   }
   ```

4. **Salve o arquivo**

5. **Reinicie completamente o Claude Desktop** (feche e abra novamente)

---

## 🔍 Outros problemas comuns

### Problema 2: Node.js não encontrado

Se você usa `nvm` (Node Version Manager), o Claude Desktop pode não encontrar o Node.js.

**Solução:** Use o caminho completo do Node.js:

```json
{
    "mcpServers": {
        "lumiz-backend": {
            "command": "/Users/ericguerrize/.nvm/versions/node/v20.19.2/bin/node",
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

**Para encontrar seu caminho do Node:**
```bash
which node
```

---

### Problema 3: Script sem permissão

**Solução:**
```bash
chmod +x /Users/ericguerrize/lumiz-backend/scripts/mcp-server.js
```

---

### Problema 4: Testar o servidor manualmente

Para verificar se o servidor funciona:

```bash
cd /Users/ericguerrize/lumiz-backend
node scripts/mcp-server.js
```

Se aparecer "MCP Server Lumiz running on stdio" sem erros, o servidor está funcionando.

---

## 🧪 Verificação passo a passo

1. ✅ **Verificar se o script existe:**
   ```bash
   ls -la /Users/ericguerrize/lumiz-backend/scripts/mcp-server.js
   ```

2. ✅ **Verificar se tem permissão:**
   ```bash
   chmod +x /Users/ericguerrize/lumiz-backend/scripts/mcp-server.js
   ```

3. ✅ **Testar manualmente:**
   ```bash
   cd /Users/ericguerrize/lumiz-backend
   SUPABASE_URL="https://whmbyfnwnlbrfmgdwdfw.supabase.co" \
   SUPABASE_SERVICE_ROLE_KEY="sua-chave" \
   node scripts/mcp-server.js
   ```

4. ✅ **Verificar JSON válido:**
   Use um validador JSON online ou:
   ```bash
   python3 -m json.tool ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```

---

## 📝 Configuração Completa Recomendada

```json
{
    "mcpServers": {
        "lumiz-backend": {
            "command": "/Users/ericguerrize/.nvm/versions/node/v20.19.2/bin/node",
            "args": [
                "/Users/ericguerrize/lumiz-backend/scripts/mcp-server.js"
            ],
            "env": {
                "SUPABASE_URL": "https://whmbyfnwnlbrfmgdwdfw.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobWJ5Zm53bmxicmZtZ2R3ZGZ3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTkxNzg3MCwiZXhwIjoyMDc3NDkzODcwfQ.7fTwCPv7I6ZasEDAHsQ90MMdjfiPNqy_bvsOk5UwTds"
            }
        }
    }
}
```

**Nota:** Use o caminho completo do Node.js se você usa `nvm`.

---

## 🆘 Ainda não funciona?

1. **Verifique os logs do Claude Desktop:**
   - Abra "Configurações do Desenvolvedor" (botão no erro)
   - Veja os logs de erro

2. **Teste o servidor isoladamente:**
   ```bash
   cd /Users/ericguerrize/lumiz-backend
   export SUPABASE_URL="https://whmbyfnwnlbrfmgdwdfw.supabase.co"
   export SUPABASE_SERVICE_ROLE_KEY="sua-chave"
   node scripts/mcp-server.js
   ```

3. **Verifique se as dependências estão instaladas:**
   ```bash
   cd /Users/ericguerrize/lumiz-backend
   npm list @modelcontextprotocol/sdk
   ```

---

## ✅ Checklist Final

- [ ] Variável `SUPABASE_SERVICE_ROLE_KEY` (não `SUPABASE_KEY`)
- [ ] Caminho do script está correto e absoluto
- [ ] Caminho do Node.js está correto (ou use `which node`)
- [ ] Script tem permissão de execução (`chmod +x`)
- [ ] JSON está válido (sem vírgulas extras, aspas corretas)
- [ ] Claude Desktop foi reiniciado completamente
- [ ] Variáveis de ambiente estão corretas
