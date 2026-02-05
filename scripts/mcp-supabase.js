#!/usr/bin/env node
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const path = require('path');

// Carrega variáveis de ambiente
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Importa cliente Supabase existente
const supabase = require('../src/db/supabase');

const server = new Server(
    {
        name: "mcp-supabase",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "read_table",
                description: "Lê dados de uma tabela do Supabase",
                inputSchema: {
                    type: "object",
                    properties: {
                        table: {
                            type: "string",
                            description: "Nome da tabela (ex: users, transactions)"
                        },
                        select: {
                            type: "string",
                            description: "Colunas para selecionar (padrão: *)",
                            default: "*"
                        },
                        limit: {
                            type: "number",
                            description: "Número máximo de registros",
                            default: 10
                        },
                        eq: {
                            type: "object",
                            description: "Filtro de igualdade (ex: {id: '123'})"
                        },
                        order: {
                            type: "object",
                            description: "Ordenação (ex: {column: 'created_at', ascending: false})"
                        }
                    },
                    required: ["table"],
                },
            },
            {
                name: "execute_rpc",
                description: "Executa uma função RPC (Remote Procedure Call) no banco",
                inputSchema: {
                    type: "object",
                    properties: {
                        function_name: { type: "string" },
                        args: { type: "object", description: "Argumentos da função" }
                    },
                    required: ["function_name"]
                }
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === "read_table") {
            const { table, select = "*", limit = 10, eq, order } = args;

            let query = supabase.from(table).select(select).limit(limit);

            if (eq) {
                for (const [key, value] of Object.entries(eq)) {
                    query = query.eq(key, value);
                }
            }

            if (order) {
                query = query.order(order.column, { ascending: order.ascending !== false });
            }

            const { data, error } = await query;

            if (error) throw new Error(error.message);

            return {
                content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
            };
        }

        if (name === "execute_rpc") {
            const { function_name, rpc_args } = args;
            const { data, error } = await supabase.rpc(function_name, rpc_args || {});

            if (error) throw new Error(error.message);

            return {
                content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
            };
        }

        throw new Error(`Ferramenta desconhecida: ${name}`);
    } catch (error) {
        return {
            content: [{ type: "text", text: `Erro: ${error.message}` }],
            isError: true,
        };
    }
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
