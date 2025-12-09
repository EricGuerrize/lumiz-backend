#!/bin/bash

# Script para configurar o MCP Server no Claude Desktop
# Uso: ./scripts/setup-mcp-claude.sh

set -e

echo "🔧 Configuração do MCP Server para Claude Desktop"
echo ""

# Detecta o sistema operacional
if [[ "$OSTYPE" == "darwin"* ]]; then
    CONFIG_FILE="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
    OS_NAME="macOS"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    CONFIG_FILE="$HOME/.config/Claude/claude_desktop_config.json"
    OS_NAME="Linux"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    CONFIG_FILE="$APPDATA/Claude/claude_desktop_config.json"
    OS_NAME="Windows"
else
    echo "❌ Sistema operacional não suportado: $OSTYPE"
    exit 1
fi

echo "📁 Sistema: $OS_NAME"
echo "📁 Arquivo de configuração: $CONFIG_FILE"
echo ""

# Verifica se o arquivo existe
if [ ! -f "$CONFIG_FILE" ]; then
    echo "⚠️  Arquivo de configuração não encontrado."
    echo "   Criando novo arquivo..."
    mkdir -p "$(dirname "$CONFIG_FILE")"
    echo '{}' > "$CONFIG_FILE"
fi

# Obtém o caminho absoluto do script MCP
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_SCRIPT="$SCRIPT_DIR/scripts/mcp-server.js"

echo "📝 Script MCP: $MCP_SCRIPT"
echo ""

# Verifica se o script existe
if [ ! -f "$MCP_SCRIPT" ]; then
    echo "❌ Script MCP não encontrado: $MCP_SCRIPT"
    exit 1
fi

# Verifica variáveis de ambiente
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "⚠️  Variáveis de ambiente não encontradas."
    echo "   Carregando do arquivo .env..."
    
    if [ -f "$SCRIPT_DIR/.env" ]; then
        export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
    else
        echo "❌ Arquivo .env não encontrado em $SCRIPT_DIR"
        echo ""
        echo "Por favor, configure manualmente:"
        echo "1. Edite: $CONFIG_FILE"
        echo "2. Adicione as variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na seção env"
        exit 1
    fi
fi

# Cria backup
BACKUP_FILE="${CONFIG_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$CONFIG_FILE" "$BACKUP_FILE"
echo "💾 Backup criado: $BACKUP_FILE"
echo ""

# Lê o JSON atual
if [ ! -s "$CONFIG_FILE" ]; then
    CURRENT_JSON='{}'
else
    CURRENT_JSON=$(cat "$CONFIG_FILE")
fi

# Usa Node.js para atualizar o JSON (mais seguro que sed/awk)
NODE_SCRIPT=$(cat <<EOF
const fs = require('fs');
const path = require('path');

const configFile = process.argv[1];
const mcpScript = process.argv[2];
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

config.mcpServers['lumiz-backend'] = {
    command: 'node',
    args: [mcpScript],
    env: {
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: supabaseKey
    }
};

fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
console.log('✅ Configuração atualizada com sucesso!');
EOF
)

# Executa o script Node.js
node -e "$NODE_SCRIPT" "$CONFIG_FILE" "$MCP_SCRIPT"

echo ""
echo "✅ Configuração concluída!"
echo ""
echo "📋 Próximos passos:"
echo "1. Reinicie o Claude Desktop"
echo "2. Teste perguntando: 'Busque os últimos 5 usuários do banco'"
echo ""
echo "📖 Para mais informações, veja: docs/MCP_SETUP.md"
