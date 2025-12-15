/**
 * Serviço de analytics/telemetria
 * Centraliza tracking de eventos para facilitar análise de funil e comportamento
 */

const supabase = require('../db/supabase');

class AnalyticsService {
    /**
     * Registra um evento de analytics
     * @param {string} eventName - Nome do evento (ex: 'onboarding_started')
     * @param {object} properties - Propriedades do evento
     * @param {string} properties.phone - Telefone do usuário
     * @param {string} properties.userId - ID do usuário (opcional)
     * @param {string} properties.source - Fonte do evento (ex: 'whatsapp', 'api')
     * @param {object} properties.properties - Propriedades adicionais (opcional)
     */
    async track(eventName, { phone, userId = null, source = 'unknown', properties = {} } = {}) {
        if (!eventName) {
            console.warn('[ANALYTICS] Evento sem nome ignorado');
            return;
        }

        const event = {
            event_name: eventName,
            phone: phone || null,
            user_id: userId || null,
            source: source,
            properties: typeof properties === 'object' ? properties : {},
            created_at: new Date().toISOString()
        };

        try {
            // Tenta salvar no Supabase (tabela analytics_events)
            // Se a tabela não existir, apenas loga (não quebra o fluxo)
            const { error } = await supabase
                .from('analytics_events')
                .insert([event]);

            if (error && error.code !== '42P01') { // 42P01 = tabela não existe
                console.error('[ANALYTICS] Erro ao salvar evento:', error.message);
            }
        } catch (e) {
            // Falha silenciosa - analytics não deve quebrar o fluxo principal
            console.error('[ANALYTICS] Erro ao trackear evento:', e?.message || e);
        }

        // Log local para desenvolvimento
        if (process.env.NODE_ENV === 'development') {
            console.log(`[ANALYTICS] ${eventName}`, {
                phone: phone ? `${phone.substring(0, 4)}***` : null,
                userId,
                source,
                properties
            });
        }
    }

    /**
     * Track múltiplos eventos de uma vez (batch)
     */
    async trackBatch(events) {
        if (!Array.isArray(events) || !events.length) return;

        try {
            const { error } = await supabase
                .from('analytics_events')
                .insert(events.map(e => ({
                    event_name: e.eventName || e.name,
                    phone: e.phone || null,
                    user_id: e.userId || null,
                    source: e.source || 'unknown',
                    properties: e.properties || {},
                    created_at: new Date().toISOString()
                })));

            if (error && error.code !== '42P01') {
                console.error('[ANALYTICS] Erro ao salvar batch:', error.message);
            }
        } catch (e) {
            console.error('[ANALYTICS] Erro ao trackear batch:', e?.message || e);
        }
    }
}

module.exports = new AnalyticsService();
