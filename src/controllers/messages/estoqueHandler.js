const estoqueService = require('../../services/estoqueService');
const copy = require('../../copy/estoqueWhatsappCopy');

class EstoqueHandler {
  async handleConsultarEstoque(user) {
    const status = await estoqueService.getEstoqueStatus(user.id);
    const produtosComDados = status.produtos.filter(
      (i) => i.estoqueMinimo > 0 || i.estoqueAtual > 0
    );
    const lista = produtosComDados.length ? produtosComDados : status.produtos;
    return copy.resumoEstoqueLinhas(lista);
  }

  async handleEntradaEstoque(user, intent, phone) {
    const dados = intent.dados || {};
    let nomeBusca = dados.categoria || dados.procedimento || dados.nome_procedimento;
    let quantidade = dados.quantidade != null ? Number(dados.quantidade) : null;

    if (quantidade != null && !Number.isFinite(quantidade)) quantidade = null;

    if (!nomeBusca || !quantidade || quantidade <= 0) {
      return copy.precisaQuantidadeENome();
    }

    const proc = await estoqueService.findProcedimentoByNome(user.id, nomeBusca);
    if (!proc) {
      return copy.erroProcedimentoNaoEncontrado(nomeBusca);
    }

    const resultado = await estoqueService.registrarEntrada(user.id, {
      procedimentoId: proc.id,
      quantidade,
      observacoes: dados.observacao || dados.observacoes || `WhatsApp (${phone})`,
    });

    return copy.entradaRegistrada(
      resultado.nome,
      resultado.quantidade,
      resultado.estoqueAtual,
      resultado.unidade
    );
  }
}

module.exports = EstoqueHandler;
