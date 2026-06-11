const estoqueService = require('../../services/estoqueService');
const estoqueProdutoService = require('../../services/estoqueProdutoService');
const conversationRuntimeStateService = require('../../services/conversationRuntimeStateService');
const copy = require('../../copy/estoqueWhatsappCopy');

class EstoqueHandler {
  constructor() {
    this.INVENTORY_SETUP_FLOW = 'inventory_setup';
    this.INVENTORY_SETUP_TTL_MS = 30 * 60 * 1000;
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

module.exports = EstoqueHandler;
