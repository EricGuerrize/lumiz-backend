const mdrService = require('../services/mdrService');
const mdrPricingService = require('../services/mdrPricingService');

class MdrController {
  async getConfig(req, res) {
    try {
      const userId = req.user?.id;
      const phone = req.user?.telefone || null;

      if (!userId) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
      }

      const config = await mdrService.getLatestConfig(phone, userId);
      return res.json({ config });
    } catch (error) {
      console.error('[MDR] Erro ao buscar configuração:', error);
      return res.status(500).json({ error: 'Erro ao buscar configuração de MDR' });
    }
  }

  async saveConfig(req, res) {
    try {
      const userId = req.user?.id;
      const phone = req.user?.telefone || null;

      if (!userId || !phone) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
      }

      const {
        provider,
        settlement_mode,
        bandeiras,
        tiposVenda,
        parcelas
      } = req.body || {};

      if (!tiposVenda || typeof tiposVenda !== 'object') {
        return res.status(400).json({ error: 'tiposVenda é obrigatório' });
      }

      const rawPayload = {
        settlement_mode: mdrPricingService.normalizeSettlementMode(settlement_mode),
        bandeiras: bandeiras || [],
        tiposVenda: tiposVenda || {},
        parcelas: parcelas || {}
      };

      const config = await mdrService.saveManualConfig({
        phone,
        userId,
        provider: provider || null,
        bandeiras: bandeiras || [],
        tiposVenda: tiposVenda || {},
        parcelas: parcelas || {},
        rawPayload
      });

      const confirmed = await mdrService.confirmConfig(config.id, {
        rawPayload: {
          ...rawPayload
        }
      });

      return res.status(201).json({
        message: 'Configuração de maquininha salva com sucesso',
        config: confirmed
      });
    } catch (error) {
      console.error('[MDR] Erro ao salvar configuração:', error);
      return res.status(500).json({ error: 'Erro ao salvar configuração de MDR' });
    }
  }

  async simulate(req, res) {
    try {
      const userId = req.user?.id;
      const phone = req.user?.telefone || null;
      if (!userId) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
      }

      const {
        valorBruto,
        formaPagamento,
        parcelas,
        bandeiraCartao,
        saleDate,
        config
      } = req.body || {};

      const value = Number(valorBruto);
      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ error: 'valorBruto inválido' });
      }

      let targetConfig = null;
      if (config && typeof config === 'object') {
        targetConfig = {
          id: 'preview',
          provider: config.provider || null,
          tipos_venda: config.tiposVenda || {},
          parcelas: config.parcelas || {},
          bandeiras: config.bandeiras || [],
          raw_payload: {
            settlement_mode: config.settlement_mode,
            tiposVenda: config.tiposVenda || {},
            parcelas: config.parcelas || {},
            bandeiras: config.bandeiras || []
          }
        };
      } else {
        targetConfig = await mdrService.getLatestConfig(phone, userId);
      }

      const simulation = mdrPricingService.calculateSalePricing({
        valorBruto: value,
        formaPagamento,
        parcelas,
        bandeiraCartao,
        saleDate,
        mdrConfig: targetConfig
      });

      return res.json({ simulation });
    } catch (error) {
      console.error('[MDR] Erro na simulação:', error);
      return res.status(500).json({ error: 'Erro ao simular cálculo de MDR' });
    }
  }
}

module.exports = new MdrController();
