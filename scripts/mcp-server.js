#!/usr/bin/env node

/**
 * MCP Server para o Lumiz Backend
 * Permite controlar e consultar o banco de dados via IA (Claude Desktop, etc)
 */

require('dotenv').config();
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { z } = require("zod");
const supabase = require('../src/db/supabase');

// Definição do Servidor
const server = new Server(
    {
        name: "lumiz-backend-mcp",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

/**
 * Tabela de Ferramentas disponíveis para a IA
 */
const TOOLS = {
    QUERY_DATABASE: "query_database",
    GET_USER_STATS: "get_user_stats",
    ANALYZE_ONBOARDING: "analyze_onboarding",
    ANALYZE_FINANCIAL: "analyze_financial",
    ANALYZE_MDR: "analyze_mdr",
    SYSTEM_HEALTH: "system_health",
    ANALYZE_INSIGHTS: "analyze_insights",
};

// Handler para listar ferramentas
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: TOOLS.QUERY_DATABASE,
                description: "Executa uma query SQL READ-ONLY no banco de dados do Supabase. Suporta agregações (COUNT, SUM, AVG, etc), JOINs e queries complexas quando a função RPC exec_sql_readonly estiver configurada. Use para buscar dados de usuários, transações ou relatórios.",
                inputSchema: {
                    type: "object",
                    properties: {
                        sql: {
                            type: "string",
                            description: "A query SQL a ser executada. Exemplos: 'SELECT COUNT(*) FROM profiles', 'SELECT * FROM profiles LIMIT 5', 'SELECT user_id, SUM(amount) FROM transactions GROUP BY user_id'",
                        },
                    },
                    required: ["sql"],
                },
            },
            {
                name: TOOLS.GET_USER_STATS,
                description: "Busca estatísticas rápidas de um usuário pelo telefone ou nome.",
                inputSchema: {
                    type: "object",
                    properties: {
                        searchTerm: {
                            type: "string",
                            description: "Número de telefone ou nome do usuário",
                        },
                    },
                    required: ["searchTerm"],
                },
            },
            {
                name: TOOLS.ANALYZE_ONBOARDING,
                description: "Analisa métricas completas de onboarding: taxa de conclusão, tempo médio, distribuição por fase, conversão MDR, NPS. Retorna insights acionáveis sobre o funil de onboarding.",
                inputSchema: {
                    type: "object",
                    properties: {
                        period: {
                            type: "string",
                            description: "Período para análise: 'today', 'week', 'month', 'all' (default: 'month')",
                            enum: ["today", "week", "month", "all"],
                        },
                    },
                },
            },
            {
                name: TOOLS.ANALYZE_FINANCIAL,
                description: "Analisa KPIs financeiros agregados: faturamento total, custos, lucro, margem, ticket médio, projeções. Pode filtrar por período ou usuário específico.",
                inputSchema: {
                    type: "object",
                    properties: {
                        period: {
                            type: "string",
                            description: "Período: 'today', 'week', 'month', 'year' ou formato 'YYYY-MM' (default: 'month')",
                        },
                        userId: {
                            type: "string",
                            description: "ID do usuário específico (opcional). Se não fornecido, analisa todos os usuários.",
                        },
                    },
                },
            },
            {
                name: TOOLS.ANALYZE_MDR,
                description: "Analisa métricas de MDR (taxas de cartão): taxa de configuração, provedores mais usados, conversão OCR vs manual, distribuição por bandeira.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: TOOLS.SYSTEM_HEALTH,
                description: "Verifica saúde do sistema: total de usuários, usuários ativos, transações recentes, jobs OCR pendentes, erros recentes. Útil para monitoramento.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: TOOLS.ANALYZE_INSIGHTS,
                description: "Analisa insights gerados pela IA: total gerados, taxa de envio, insights mais comuns, usuários que mais recebem insights, padrões temporais.",
                inputSchema: {
                    type: "object",
                    properties: {
                        period: {
                            type: "string",
                            description: "Período: 'today', 'week', 'month' (default: 'month')",
                            enum: ["today", "week", "month"],
                        },
                    },
                },
            },
        ],
    };
});

// Handler para executar ferramentas
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case TOOLS.QUERY_DATABASE: {
                const sql = args.sql.trim();

                // Bloqueio de segurança simples (apenas SELECT)
                if (!sql.toLowerCase().startsWith('select')) {
                    throw new Error("Apenas queries SELECT são permitidas por segurança.");
                }

                // Tenta usar a função RPC exec_sql_readonly (suporta agregações e queries complexas)
                try {
                    const { data, error } = await supabase.rpc('exec_sql_readonly', {
                        query_text: sql
                    });

                    if (error) {
                        // Se a função RPC não existir, faz fallback para método antigo
                        if (error.message && error.message.includes('function') && error.message.includes('does not exist')) {
                            console.error("Função RPC exec_sql_readonly não encontrada. Usando método fallback.");
                            throw new Error('RPC_NOT_AVAILABLE');
                        }
                        throw error;
                    }

                    // A função RPC retorna JSONB diretamente
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(data, null, 2),
                            },
                        ],
                    };
                } catch (error) {
                    // Fallback: método antigo para queries simples (sem agregações)
                    if (error.message === 'RPC_NOT_AVAILABLE' || (error.message && error.message.includes('function'))) {
                        // Detecta se é uma query de agregação
                        const isAggregation = /(count|sum|avg|min|max|group\s+by)/i.test(sql);
                        
                        if (isAggregation) {
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `⚠️ Esta query requer agregação, mas a função RPC não está disponível.\n\nPara suportar agregações (COUNT, SUM, etc), execute a migração:\n\nsupabase/migrations/20251209_create_mcp_exec_sql.sql\n\nOu execute no Supabase SQL Editor:\n\nCREATE OR REPLACE FUNCTION exec_sql_readonly(query_text TEXT)\nRETURNS JSONB\nLANGUAGE plpgsql\nSECURITY DEFINER\nAS $$\nDECLARE\n    result JSONB;\n    query_lower TEXT;\nBEGIN\n    query_lower := LOWER(TRIM(query_text));\n    IF NOT (query_lower ~ '^\\s*select\\s') THEN\n        RAISE EXCEPTION 'Apenas queries SELECT são permitidas';\n    END IF;\n    IF query_lower ~* '(insert|update|delete|drop|create|alter|truncate)' THEN\n        RAISE EXCEPTION 'Comandos de modificação não são permitidos';\n    END IF;\n    EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query_text) INTO result;\n    RETURN COALESCE(result, '[]'::jsonb);\nEXCEPTION\n    WHEN OTHERS THEN\n        RAISE EXCEPTION 'Erro: %%', SQLERRM;\nEND;\n$$;`,
                                    },
                                ],
                                isError: true,
                            };
                        }

                        // Fallback para queries simples sem agregação
                        const tableMatch = sql.match(/from\s+([a-zA-Z0-9_]+)/i);
                        if (!tableMatch) {
                            return { 
                                content: [{ 
                                    type: "text", 
                                    text: "Não consegui identificar a tabela na query. Para queries complexas, configure a função RPC exec_sql_readonly." 
                                }] 
                            };
                        }

                        const table = tableMatch[1];
                        let query = supabase.from(table).select('*');

                        // Tenta extrair LIMIT da query
                        const limitMatch = sql.match(/limit\s+(\d+)/i);
                        if (limitMatch) {
                            query = query.limit(parseInt(limitMatch[1]));
                        } else {
                            query = query.limit(10); // Limite padrão
                        }

                        const { data, error: queryError } = await query;
                        if (queryError) throw queryError;

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify(data, null, 2),
                                },
                            ],
                        };
                    }
                    
                    throw error;
                }
            }

            case TOOLS.GET_USER_STATS: {
                const term = args.searchTerm;

                // Busca perfil
                let query = supabase.from('profiles').select('*');
                if (term.includes('55')) {
                    query = query.eq('telefone', term);
                } else {
                    query = query.ilike('nome_completo', `%${term}%`);
                }

                const { data: users, error } = await query;

                if (error || !users.length) {
                    return { content: [{ type: "text", text: "Usuário não encontrado." }] };
                }

                const user = users[0];

                // Busca transações recentes
                const { data: transacoes } = await supabase
                    .from('transactions')
                    .select('*')
                    .eq('user_id', user.id)
                    .order('date', { ascending: false })
                    .limit(5);

                return {
                    content: [
                        {
                            type: "text",
                            text: `Perfil: ${user.nome_completo} (${user.telefone})\nPlano: ${user.plan_type}\n\nÚltimas 5 Transações:\n${JSON.stringify(transacoes, null, 2)}`,
                        },
                    ],
                };
            }

            case TOOLS.ANALYZE_ONBOARDING: {
                const period = args.period || 'month';
                let dateFilter = '';
                
                if (period === 'today') {
                    dateFilter = "created_at >= CURRENT_DATE";
                } else if (period === 'week') {
                    dateFilter = "created_at >= CURRENT_DATE - INTERVAL '7 days'";
                } else if (period === 'month') {
                    dateFilter = "created_at >= DATE_TRUNC('month', CURRENT_DATE)";
                }

                const whereClause = dateFilter ? `WHERE ${dateFilter}` : '';
                
                const sql = `
                    SELECT 
                        COUNT(*) as total,
                        COUNT(*) FILTER (WHERE completed = true) as completed,
                        ROUND(COUNT(*) FILTER (WHERE completed = true)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as completion_rate,
                        COUNT(*) FILTER (WHERE stage = 'phase1' AND NOT completed) as phase1_in_progress,
                        COUNT(*) FILTER (WHERE stage = 'phase2' AND NOT completed) as phase2_in_progress,
                        COUNT(*) FILTER (WHERE stage = 'phase3' AND NOT completed) as phase3_in_progress,
                        COUNT(*) FILTER (WHERE data->'phase2'->>'mdr_status' = 'configured') as mdr_configured,
                        ROUND(COUNT(*) FILTER (WHERE data->'phase2'->>'mdr_status' = 'configured')::numeric / NULLIF(COUNT(*), 0) * 100, 1) as mdr_conversion_rate,
                        ROUND(AVG(nps_score), 1) as avg_nps,
                        ROUND(AVG(progress_percent), 1) as avg_progress
                    FROM onboarding_progress
                    ${whereClause}
                `;

                const { data, error } = await supabase.rpc('exec_sql_readonly', { query_text: sql });
                
                if (error) {
                    // Fallback se RPC não disponível
                    const { data: allData } = await supabase
                        .from('onboarding_progress')
                        .select('*');
                    
                    if (!allData) throw error;
                    
                    const filtered = period === 'all' ? allData : allData.filter(item => {
                        const created = new Date(item.created_at);
                        const now = new Date();
                        if (period === 'today') return created.toDateString() === now.toDateString();
                        if (period === 'week') return (now - created) / (1000 * 60 * 60 * 24) <= 7;
                        if (period === 'month') return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
                        return true;
                    });
                    
                    const total = filtered.length;
                    const completed = filtered.filter(x => x.completed).length;
                    const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
                    
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                period,
                                total,
                                completed,
                                completion_rate: parseFloat(completionRate),
                                phase1_in_progress: filtered.filter(x => x.stage === 'phase1' && !x.completed).length,
                                phase2_in_progress: filtered.filter(x => x.stage === 'phase2' && !x.completed).length,
                                phase3_in_progress: filtered.filter(x => x.stage === 'phase3' && !x.completed).length,
                                mdr_configured: filtered.filter(x => x.data?.phase2?.mdr_status === 'configured').length,
                                mdr_conversion_rate: total > 0 ? parseFloat(((filtered.filter(x => x.data?.phase2?.mdr_status === 'configured').length / total) * 100).toFixed(1)) : 0,
                                avg_nps: filtered.filter(x => x.nps_score).length > 0 
                                    ? parseFloat((filtered.filter(x => x.nps_score).reduce((a, b) => a + (b.nps_score || 0), 0) / filtered.filter(x => x.nps_score).length).toFixed(1))
                                    : null,
                                avg_progress: filtered.length > 0 
                                    ? parseFloat((filtered.reduce((a, b) => a + (b.progress_percent || 0), 0) / filtered.length).toFixed(1))
                                    : 0
                            }, null, 2)
                        }]
                    };
                }
                
                return { content: [{ type: "text", text: JSON.stringify(data[0] || {}, null, 2) }] };
            }

            case TOOLS.ANALYZE_FINANCIAL: {
                const period = args.period || 'month';
                const userId = args.userId;
                
                // Determina filtro de data
                let dateFilter = '';
                if (period === 'today') {
                    dateFilter = "date = CURRENT_DATE";
                } else if (period === 'week') {
                    dateFilter = "date >= CURRENT_DATE - INTERVAL '7 days'";
                } else if (period === 'month') {
                    dateFilter = "date >= DATE_TRUNC('month', CURRENT_DATE)";
                } else if (period === 'year') {
                    dateFilter = "date >= DATE_TRUNC('year', CURRENT_DATE)";
                } else if (period.match(/^\d{4}-\d{2}$/)) {
                    // Formato YYYY-MM
                    dateFilter = `date >= '${period}-01' AND date < '${period}-01'::date + INTERVAL '1 month'`;
                }
                
                const userFilter = userId ? `AND user_id = '${userId}'` : '';
                const whereClause = dateFilter ? `WHERE ${dateFilter} ${userFilter}`.trim() : (userId ? `WHERE user_id = '${userId}'` : '');
                
                const sql = `
                    SELECT 
                        COUNT(*) FILTER (WHERE type = 'entrada') as total_entradas,
                        COUNT(*) FILTER (WHERE type = 'saida') as total_saidas,
                        COALESCE(SUM(amount) FILTER (WHERE type = 'entrada'), 0) as receitas,
                        COALESCE(SUM(amount) FILTER (WHERE type = 'saida'), 0) as custos,
                        COALESCE(SUM(amount) FILTER (WHERE type = 'entrada'), 0) - COALESCE(SUM(amount) FILTER (WHERE type = 'saida'), 0) as lucro,
                        CASE 
                            WHEN SUM(amount) FILTER (WHERE type = 'entrada') > 0 
                            THEN ROUND((SUM(amount) FILTER (WHERE type = 'entrada') - COALESCE(SUM(amount) FILTER (WHERE type = 'saida'), 0)) / SUM(amount) FILTER (WHERE type = 'entrada') * 100, 1)
                            ELSE 0
                        END as margem_lucro,
                        CASE 
                            WHEN COUNT(*) FILTER (WHERE type = 'entrada') > 0
                            THEN ROUND(SUM(amount) FILTER (WHERE type = 'entrada') / COUNT(*) FILTER (WHERE type = 'entrada'), 2)
                            ELSE 0
                        END as ticket_medio
                    FROM transactions
                    ${whereClause}
                `;

                const { data, error } = await supabase.rpc('exec_sql_readonly', { query_text: sql });
                
                if (error) throw error;
                
                return { content: [{ type: "text", text: JSON.stringify({ period, ...(data[0] || {}) }, null, 2) }] };
            }

            case TOOLS.ANALYZE_MDR: {
                const sql = `
                    SELECT 
                        COUNT(DISTINCT user_id) as total_users,
                        COUNT(*) as total_configs,
                        COUNT(*) FILTER (WHERE source = 'ocr') as ocr_configs,
                        COUNT(*) FILTER (WHERE source = 'manual') as manual_configs,
                        COUNT(DISTINCT provider) as providers_count,
                        jsonb_object_agg(
                            provider, 
                            COUNT(*) FILTER (WHERE provider IS NOT NULL)
                        ) FILTER (WHERE provider IS NOT NULL) as providers_distribution
                    FROM mdr_configs
                `;

                const { data, error } = await supabase.rpc('exec_sql_readonly', { query_text: sql });
                
                if (error) {
                    // Fallback
                    const { data: allConfigs } = await supabase.from('mdr_configs').select('*');
                    if (!allConfigs) throw error;
                    
                    const providers = {};
                    allConfigs.forEach(c => {
                        if (c.provider) providers[c.provider] = (providers[c.provider] || 0) + 1;
                    });
                    
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                total_users: new Set(allConfigs.map(c => c.user_id)).size,
                                total_configs: allConfigs.length,
                                ocr_configs: allConfigs.filter(c => c.source === 'ocr').length,
                                manual_configs: allConfigs.filter(c => c.source === 'manual').length,
                                providers_count: Object.keys(providers).length,
                                providers_distribution: providers
                            }, null, 2)
                        }]
                    };
                }
                
                return { content: [{ type: "text", text: JSON.stringify(data[0] || {}, null, 2) }] };
            }

            case TOOLS.SYSTEM_HEALTH: {
                const queries = [
                    { name: 'total_users', sql: "SELECT COUNT(*) as count FROM profiles" },
                    { name: 'active_users', sql: "SELECT COUNT(*) as count FROM profiles WHERE is_active = true" },
                    { name: 'recent_transactions', sql: "SELECT COUNT(*) as count FROM transactions WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'" },
                    { name: 'pending_ocr_jobs', sql: "SELECT COUNT(*) as count FROM ocr_jobs WHERE status = 'pending'" },
                    { name: 'failed_ocr_jobs', sql: "SELECT COUNT(*) as count FROM ocr_jobs WHERE status = 'failed'" },
                    { name: 'onboarding_in_progress', sql: "SELECT COUNT(*) as count FROM onboarding_progress WHERE completed = false" }
                ];

                const results = {};
                
                for (const query of queries) {
                    try {
                        const { data, error } = await supabase.rpc('exec_sql_readonly', { query_text: query.sql });
                        if (!error && data && data[0]) {
                            results[query.name] = parseInt(data[0].count || data[0][Object.keys(data[0])[0]] || 0);
                        } else {
                            // Fallback
                            const table = query.sql.match(/FROM\s+([a-zA-Z0-9_]+)/i)?.[1];
                            if (table) {
                                const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
                                results[query.name] = count || 0;
                            }
                        }
                    } catch (e) {
                        results[query.name] = 'error';
                    }
                }

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            timestamp: new Date().toISOString(),
                            ...results,
                            health_status: results.pending_ocr_jobs > 10 ? 'warning' : 'healthy'
                        }, null, 2)
                    }]
                };
            }

            case TOOLS.ANALYZE_INSIGHTS: {
                const period = args.period || 'month';
                let dateFilter = '';
                
                if (period === 'today') {
                    dateFilter = "created_at >= CURRENT_DATE";
                } else if (period === 'week') {
                    dateFilter = "created_at >= CURRENT_DATE - INTERVAL '7 days'";
                } else if (period === 'month') {
                    dateFilter = "created_at >= DATE_TRUNC('month', CURRENT_DATE)";
                }

                const whereClause = dateFilter ? `WHERE ${dateFilter}` : '';
                
                const sql = `
                    SELECT 
                        COUNT(*) as total_insights,
                        COUNT(*) FILTER (WHERE sent_at IS NOT NULL) as sent_insights,
                        COUNT(DISTINCT user_id) as users_with_insights,
                        ROUND(COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as send_rate,
                        COUNT(*) FILTER (WHERE sent_via = 'whatsapp') as sent_via_whatsapp,
                        COUNT(*) FILTER (WHERE sent_via = 'app') as sent_via_app
                    FROM user_insights
                    ${whereClause}
                `;

                const { data, error } = await supabase.rpc('exec_sql_readonly', { query_text: sql });
                
                if (error) {
                    // Fallback
                    const { data: allInsights } = await supabase.from('user_insights').select('*');
                    if (!allInsights) throw error;
                    
                    const filtered = period === 'all' ? allInsights : allInsights.filter(item => {
                        const created = new Date(item.created_at);
                        const now = new Date();
                        if (period === 'today') return created.toDateString() === now.toDateString();
                        if (period === 'week') return (now - created) / (1000 * 60 * 60 * 24) <= 7;
                        if (period === 'month') return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
                        return true;
                    });
                    
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                period,
                                total_insights: filtered.length,
                                sent_insights: filtered.filter(x => x.sent_at).length,
                                users_with_insights: new Set(filtered.map(x => x.user_id)).size,
                                send_rate: filtered.length > 0 ? parseFloat(((filtered.filter(x => x.sent_at).length / filtered.length) * 100).toFixed(1)) : 0,
                                sent_via_whatsapp: filtered.filter(x => x.sent_via === 'whatsapp').length,
                                sent_via_app: filtered.filter(x => x.sent_via === 'app').length
                            }, null, 2)
                        }]
                    };
                }
                
                return { content: [{ type: "text", text: JSON.stringify({ period, ...(data[0] || {}) }, null, 2) }] };
            }

            default:
                throw new Error(`Ferramenta desconhecida: ${name}`);
        }
    } catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Erro ao executar ferramenta: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});

// Inicializa o servidor
async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP Server Lumiz running on stdio");
}

run().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
