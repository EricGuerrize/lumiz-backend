const estoqueService = require('../../services/estoqueService');
const estoqueProdutoService = require('../../services/estoqueProdutoService');
const procedimentoConsumoService = require('../../services/procedimentoConsumoService');
const conversationRuntimeStateService = require('../../services/conversationRuntimeStateService');
const copy = require('../../copy/estoqueWhatsappCopy');

class EstoqueHandler {
  constructor() {
    this.INVENTORY_SETUP_FLOW = 'inventory_setup';
    this.INVENTORY_SETUP_TTL_MS = 30 * 60 * 1000;
    this.STOCK_AFTER_SALE_FLOW = EstoqueHandler.STOCK_AFTER_SALE_FLOW;
    this.STOCK_AFTER_SALE_TTL_MS = EstoqueHandler.STOCK_AFTER_SALE_TTL_MS;
  }

  // ==========================================================================
  // Item 23 (replanejado) — baixa de estoque pós-procedimento, sob confirmação.
  // Nunca baixa automaticamente: pergunta → secretária digita → confirma.
  // ==========================================================================

  /**
   * Abre o fluxo opcional de baixa após uma venda confirmada.
   * @param {string} phone
   * @param {{atendimentoId?: string, procedimentoNome?: string}} context
   * @returns {Promise<void>}
   */
  async startStockAfterSale(phone, context = {}) {
    await conversationRuntimeStateService.upsert(
      phone,
      this.STOCK_AFTER_SALE_FLOW,
      {
        stage: 'ask',
        atendimentoId: context.atendimentoId || null,
        procedimentoNome: context.procedimentoNome || null,
      },
      this.STOCK_AFTER_SALE_TTL_MS
    );
  }

  async hasPendingStockAfterSale(phone) {
    const pending = await conversationRuntimeStateService.get(phone, this.STOCK_AFTER_SALE_FLOW);
    return Boolean(pending?.payload?.stage);
  }

  /**
   * Máquina de estados do fluxo pós-procedimento.
   * @param {string} phone
   * @param {string} message
   * @param {object} user
   * @returns {Promise<string|null>}
   */
  async handlePendingStockAfterSale(phone, message, user) {
    const pending = await conversationRuntimeStateService.get(phone, this.STOCK_AFTER_SALE_FLOW);
    const payload = pending?.payload;
    if (!payload?.stage) return null;

    const normalized = String(message || '').trim().toLowerCase();
    const isYes = ['1', 'sim', 's', 'confirmar', 'confirma'].includes(normalized);
    const isNo = ['2', 'não', 'nao', 'n', 'cancelar'].includes(normalized);
    const isCorrect = ['3', 'corrigir', 'corrige', 'editar'].includes(normalized);

    // Etapa 1: pergunta Sim/Não
    if (payload.stage === 'ask') {
      if (isNo) {
        await conversationRuntimeStateService.clear(phone, this.STOCK_AFTER_SALE_FLOW);
        return copy.baixaPosProcedimentoIgnorada();
      }
      if (isYes) {
        await conversationRuntimeStateService.upsert(
          phone,
          this.STOCK_AFTER_SALE_FLOW,
          { ...payload, stage: 'awaiting_items' },
          this.STOCK_AFTER_SALE_TTL_MS
        );
        return copy.perguntarInsumosUsados();
      }
      // Resposta fora do esperado: repete a pergunta.
      return copy.perguntarInsumosUsados();
    }

    // Etapa de revisão: digitou os insumos
    if (payload.stage === 'awaiting_items') {
      const itens = procedimentoConsumoService.parseUsedItems(message);
      if (!itens.length) return copy.baixaInsumosNaoEntendi();

      await conversationRuntimeStateService.upsert(
        phone,
        this.STOCK_AFTER_SALE_FLOW,
        { ...payload, stage: 'confirm', itens },
        this.STOCK_AFTER_SALE_TTL_MS
      );
      return copy.resumoBaixaPosProcedimento(itens);
    }

    // Etapa de confirmação do resumo
    if (payload.stage === 'confirm') {
      if (isNo) {
        await conversationRuntimeStateService.clear(phone, this.STOCK_AFTER_SALE_FLOW);
        return copy.baixaPosProcedimentoIgnorada();
      }
      if (isCorrect) {
        await conversationRuntimeStateService.upsert(
          phone,
          this.STOCK_AFTER_SALE_FLOW,
          { ...payload, stage: 'awaiting_items', itens: undefined },
          this.STOCK_AFTER_SALE_TTL_MS
        );
        return copy.baixaPosProcedimentoCorrigir();
      }
      if (isYes) {
        const result = await this._applyStockAfterSale(user.id, payload, phone);
        await conversationRuntimeStateService.clear(phone, this.STOCK_AFTER_SALE_FLOW);
        return copy.baixaPosProcedimentoConfirmada(result);
      }
      // Resposta inesperada: repete o resumo.
      return copy.resumoBaixaPosProcedimento(payload.itens || []);
    }

    return null;
  }

  /**
   * Aplica a baixa item a item, separando sucessos de falhas.
   * @private
   */
  async _applyStockAfterSale(userId, payload, phone) {
    const applied = [];
    const failed = [];
    for (const item of payload.itens || []) {
      try {
        const res = await estoqueProdutoService.registrarSaida(userId, {
          nome: item.nome,
          quantidade: item.quantidade,
          origem: 'pos_procedimento',
          sourcePhone: phone,
          observacoes: 'Baixa pós-procedimento (confirmada via WhatsApp)',
          metadata: {
            atendimento_id: payload.atendimentoId || null,
            procedimento_nome: payload.procedimentoNome || null,
          },
        });
        applied.push({
          nome: res?.nome || item.nome,
          quantidade: item.quantidade,
          unidade: res?.unidade || item.unidade,
          estoqueAtual: res?.estoqueAtual,
        });
      } catch (error) {
        failed.push({ nome: item.nome, erro: error.message });
      }
    }
    return { applied, failed };
  }

  async hasPendingInventorySetup(phone) {
    const pending = await conversationRuntimeStateService.get(phone, this.INVENTORY_SETUP_FLOW);
    return Boolean(pending?.payload?.stage);
  }

  async handlePendingInventorySetup(phone, message, user) {
    const pending = await conversationRuntimeStateService.get(phone, this.INVENTORY_SETUP_FLOW);
    if (!pending?.payload?.stage) return null;

    const normalized = String(message || '').trim().toLowerCase();
    const isConfirm = ['1', 'sim', 's', 'confirmar'].includes(normalized);
    const isCancel = ['2', 'não', 'nao', 'n', 'cancelar'].includes(normalized);
    const isCorrect = ['3', 'corrigir', 'corrige', 'editar'].includes(normalized);

    if (pending.payload.stage === 'awaiting_correction') {
      const itensCorrigidos = estoqueProdutoService.parseInventoryText(message);
      if (!itensCorrigidos.length) return copy.configurarEstoqueInstrucoes();

      await conversationRuntimeStateService.upsert(
        phone,
        this.INVENTORY_SETUP_FLOW,
        { stage: 'confirm', itens: itensCorrigidos },
        this.INVENTORY_SETUP_TTL_MS
      );
      return copy.confirmarInventarioInicial(itensCorrigidos);
    }

    if (isCancel) {
      await conversationRuntimeStateService.clear(phone, this.INVENTORY_SETUP_FLOW);
      return copy.inventarioCancelado();
    }

    if (isCorrect) {
      await conversationRuntimeStateService.upsert(
        phone,
        this.INVENTORY_SETUP_FLOW,
        { ...pending.payload, stage: 'awaiting_correction' },
        this.INVENTORY_SETUP_TTL_MS
      );
      return copy.inventarioCorrigir();
    }

    if (!isConfirm) {
      return copy.confirmarInventarioInicial(pending.payload.itens || []);
    }

    const result = await estoqueProdutoService.configureInitialInventory(
      user.id,
      pending.payload.itens || [],
      { sourcePhone: phone }
    );
    await conversationRuntimeStateService.clear(phone, this.INVENTORY_SETUP_FLOW);
    return copy.inventarioConfirmado(result);
  }

  async handleConfigurarEstoque(user, phone, message = '') {
    const itens = estoqueProdutoService.parseInventoryText(message);
    if (!itens.length) {
      await conversationRuntimeStateService.upsert(
        phone,
        this.INVENTORY_SETUP_FLOW,
        { stage: 'awaiting_correction', itens: [] },
        this.INVENTORY_SETUP_TTL_MS
      );
      return copy.configurarEstoqueInstrucoes();
    }

    await conversationRuntimeStateService.upsert(
      phone,
      this.INVENTORY_SETUP_FLOW,
      { stage: 'confirm', itens },
      this.INVENTORY_SETUP_TTL_MS
    );
    return copy.confirmarInventarioInicial(itens);
  }

  async handleConsultarEstoque(user, intent = {}) {
    const termo = intent.dados?.produto || intent.dados?.categoria || intent.dados?.nome_procedimento;
    if (termo) {
      const item = await estoqueProdutoService.getProdutoStatus(user.id, termo)
        .catch(() => null) || await estoqueService.getProdutoStatus(user.id, termo);
      return copy.saldoProduto(item);
    }

    let status = null;
    try {
      status = await estoqueProdutoService.getEstoqueStatus(user.id);
    } catch (error) {
      status = null;
    }
    if (!status?.produtos?.length) {
      status = await estoqueService.getEstoqueStatus(user.id);
    }
    const produtosComDados = status.produtos.filter(
      (i) => i.estoqueMinimo > 0 || i.estoqueAtual > 0
    );
    const lista = produtosComDados.length ? produtosComDados : status.produtos;
    return copy.resumoEstoqueLinhas(lista);
  }

  async handleSaidaEstoque(user, intent, phone) {
    return copy.baixaManualSuspensa();
  }

  async handleEntradaEstoque(user, intent, phone) {
    const dados = intent.dados || {};
    let nomeBusca = dados.categoria || dados.produto || dados.procedimento || dados.nome_procedimento;
    let quantidade = dados.quantidade != null ? Number(dados.quantidade) : null;

    if (quantidade != null && !Number.isFinite(quantidade)) quantidade = null;

    if (!nomeBusca || !quantidade || quantidade <= 0) {
      return copy.precisaQuantidadeENome();
    }

    let resultado = await estoqueProdutoService.registrarEntrada(user.id, {
      nome: nomeBusca,
      quantidade,
      unidade: dados.unidade || undefined,
      allowCreate: true,
      origem: 'whatsapp_text',
      sourcePhone: phone,
      observacoes: dados.observacao || dados.observacoes || `WhatsApp (${phone})`,
    }).catch(() => null);

    if (!resultado) {
      const proc = await estoqueService.findProcedimentoByNome(user.id, nomeBusca);
      if (!proc) return copy.erroProcedimentoNaoEncontrado(nomeBusca);
      resultado = await estoqueService.registrarEntrada(user.id, {
        procedimentoId: proc.id,
        quantidade,
        observacoes: dados.observacao || dados.observacoes || `WhatsApp (${phone})`,
      });
    }

    return copy.entradaRegistrada(
      resultado.nome,
      resultado.quantidade,
      resultado.estoqueAtual,
      resultado.unidade
    );
  }
}

// Nome do flow compartilhado com o transactionHandler (que abre o pending após
// uma venda confirmada). Mantido como estático para haver fonte única da verdade.
EstoqueHandler.STOCK_AFTER_SALE_FLOW = 'stock_after_sale';
EstoqueHandler.STOCK_AFTER_SALE_TTL_MS = 15 * 60 * 1000;

module.exports = EstoqueHandler;
