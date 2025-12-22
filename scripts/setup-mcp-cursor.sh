#!/bin/bash

# Script para configurar o MCP Server no Cursor IDE
# Uso: ./scripts/setup-mcp-cursor.sh

set -e

echo "🔧 Configuração do MCP Server para Cursor IDE"
echo ""

# Detecta o sistema operacional
if [[ "$OSTYPE" == "darwin"* ]]; then
    CONFIG_FILE="$HOME/.cursor/mcp.json"
    CONFIG_FILE_ALT="$HOME/Library/Application Support/Cursor/User/mcp.json"
    OS_NAME="macOS"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    CONFIG_FILE="$HOME/.cursor/mcp.json"
    CONFIG_FILE_ALT="$HOME/.config/Cursor/User/mcp.json"
    OS_NAME="Linux"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    CONFIG_FILE="$HOME/.cursor/mcp.json"
    CONFIG_FILE_ALT="$APPDATA/Cursor/User/mcp.json"
    OS_NAME="Windows"
else
    echo "❌ Sistema operacional não suportado: $OSTYPE"
    exit 1
fi

echo "📁 Sistema: $OS_NAME"
echo ""

# Tenta localizar o arquivo de configuração
if [ -f "$CONFIG_FILE" ]; then
    ACTUAL_CONFIG_FILE="$CONFIG_FILE"
elif [ -f "$CONFIG_FILE_ALT" ]; then
    ACTUAL_CONFIG_FILE="$CONFIG_FILE_ALT"
else
    # Cria no local padrão
    ACTUAL_CONFIG_FILE="$CONFIG_FILE"
    mkdir -p "$(dirname "$ACTUAL_CONFIG_FILE")"
    echo "📝 Criando arquivo de configuração: $ACTUAL_CONFIG_FILE"
fi

echo "📁 Arquivo de configuração: $ACTUAL_CONFIG_FILE"
echo ""

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
        # Carrega apenas variáveis SUPABASE (seguro)
        export $(grep -v '^#' "$SCRIPT_DIR/.env" | grep "^SUPABASE" | xargs)
        echo "✅ Variáveis carregadas do .env"
    else
        echo "❌ Arquivo .env não encontrado em $SCRIPT_DIR"
        echo ""
        echo "Por favor, configure manualmente:"
        echo "1. Edite: $ACTUAL_CONFIG_FILE"
        echo "2. Adicione as variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY"
        exit 1
    fi
fi

# Verifica se as variáveis foram carregadas
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "❌ Variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não encontradas"
    echo ""
    echo "Por favor, adicione no arquivo .env:"
    echo "SUPABASE_URL=https://seu-projeto.supabase.co"
    echo "SUPABASE_SERVICE_ROLE_KEY=sua_chave_service_role"
    exit 1
fi

# Cria backup se arquivo já existe
if [ -f "$ACTUAL_CONFIG_FILE" ]; then
    BACKUP_FILE="${ACTUAL_CONFIG_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$ACTUAL_CONFIG_FILE" "$BACKUP_FILE"
    echo "💾 Backup criado: $BACKUP_FILE"
    echo ""
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
    if (fs.existsSync(configFile)) {
        const content = fs.readFileSync(configFile, 'utf8');
        if (content.trim()) {
            config = JSON.parse(content);
        }
    }
} catch (e) {
    console.error('Erro ao ler config:', e.message);
    process.exit(1);
}

// Cursor usa estrutura simples: array de servidores ou objeto
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

// Cria diretório se não existir
const dir = path.dirname(configFile);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
console.log('✅ Configuração atualizada com sucesso!');
EOF
)

# Executa o script Node.js
node -e "$NODE_SCRIPT" "$ACTUAL_CONFIG_FILE" "$MCP_SCRIPT"

echo ""
echo "✅ Configuração concluída!"
echo ""
echo "📋 Próximos passos:"
echo "1. Reinicie completamente o Cursor (Cmd+Q no macOS)"
echo "2. Abra o Cursor novamente"
echo "3. Teste perguntando: 'Busque os últimos 5 usuários do banco'"
echo ""
echo "📄 Arquivo de configuração:"
echo "   $ACTUAL_CONFIG_FILE"
echo ""
echo "🔍 Para verificar se funcionou:"
echo "   cat $ACTUAL_CONFIG_FILE"


