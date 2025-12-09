#!/bin/bash

# Script para corrigir a configuração do MCP no Claude Desktop

set -e

echo "🔧 Corrigindo configuração do MCP no Claude Desktop"
echo ""

CONFIG_FILE="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
PROJECT_DIR="/Users/ericguerrize/lumiz-backend"
MCP_SCRIPT="$PROJECT_DIR/scripts/mcp-server.js"

# Verifica se o arquivo existe
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Arquivo de configuração não encontrado: $CONFIG_FILE"
    echo "   Criando novo arquivo..."
    mkdir -p "$(dirname "$CONFIG_FILE")"
    echo '{}' > "$CONFIG_FILE"
fi

# Cria backup
BACKUP_FILE="${CONFIG_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$CONFIG_FILE" "$BACKUP_FILE"
echo "💾 Backup criado: $BACKUP_FILE"
echo ""

# Carrega variáveis do .env
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | grep SUPABASE | xargs)
    echo "✅ Variáveis carregadas do .env"
else
    echo "⚠️  Arquivo .env não encontrado"
    echo "   Você precisará adicionar manualmente as variáveis"
fi

# Encontra o Node.js
NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
    echo "❌ Node.js não encontrado no PATH"
    echo "   Usando 'node' como comando (pode não funcionar com nvm)"
    NODE_CMD="node"
else
    echo "✅ Node.js encontrado: $NODE_PATH"
    NODE_CMD="$NODE_PATH"
fi

# Gera a configuração correta usando Node.js
NODE_SCRIPT=$(cat <<EOF
const fs = require('fs');
const path = require('path');

const configFile = process.argv[1];
const nodeCmd = process.env.NODE_CMD || 'node';
const mcpScript = process.argv[2];
const supabaseUrl = process.env.SUPABASE_URL || 'https://whmbyfnwnlbrfmgdwdfw.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let config = {};
try {
    const content = fs.readFileSync(configFile, 'utf8');
    if (content.trim()) {
        config = JSON.parse(content);
    }
} catch (e) {
    console.error('Erro ao ler config:', e.message);
    process.exit(1);
}

if (!config.mcpServers) {
    config.mcpServers = {};
}

// Remove configuração antiga se existir
if (config.mcpServers['lumiz-backend']) {
    console.log('⚠️  Substituindo configuração existente...');
}

// Cria configuração correta
config.mcpServers['lumiz-backend'] = {
    command: nodeCmd,
    args: [mcpScript],
    env: {
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: supabaseKey || 'COLE_SUA_CHAVE_AQUI'
    }
};

fs.writeFileSync(configFile, JSON.stringify(config, null, 4));
console.log('✅ Configuração atualizada!');
console.log('');
console.log('📋 Verifique se SUPABASE_SERVICE_ROLE_KEY está correto');
if (!supabaseKey) {
    console.log('⚠️  ATENÇÃO: SUPABASE_SERVICE_ROLE_KEY não foi encontrado no .env');
    console.log('   Você precisará editar manualmente o arquivo e adicionar a chave');
}
EOF
)

NODE_CMD="$NODE_CMD" SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" node -e "$NODE_SCRIPT" "$CONFIG_FILE" "$MCP_SCRIPT"

echo ""
echo "✅ Configuração corrigida!"
echo ""
echo "📝 Mudanças principais:"
echo "   - ✅ Variável renomeada: SUPABASE_KEY → SUPABASE_SERVICE_ROLE_KEY"
echo "   - ✅ Caminho do Node.js: $NODE_CMD"
echo ""
echo "🔄 Próximos passos:"
echo "   1. Verifique se SUPABASE_SERVICE_ROLE_KEY está correto no arquivo"
echo "   2. Reinicie completamente o Claude Desktop"
echo "   3. O erro 'Server disconnected' deve desaparecer"
echo ""
echo "📄 Arquivo de configuração:"
echo "   $CONFIG_FILE"
