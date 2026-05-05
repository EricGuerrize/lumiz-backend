function alertaMargemCaindo(dados) {
  const delta = Math.abs(Number(dados?.delta) || 0);
  const margemAtual = Number(dados?.margem_atual) || 0;
  const margemAnterior = Number(dados?.margem_anterior) || 0;
  const causa = String(dados?.causa || 'indefinido');
  const causaTexto =
    causa === 'custo'
      ? 'custos por atendimento subiram'
      : causa === 'preco'
        ? 'ticket médio caiu'
        : causa === 'volume'
          ? 'volume de atendimentos mudou'
          : 'houve variação de mix/volume';

  return (
    `⚠️ Sua margem caiu ${delta.toFixed(1)} pontos este mês.\n\n` +
    `Margem atual: ${margemAtual.toFixed(1)}% vs ${margemAnterior.toFixed(1)}% no mês passado.\n\n` +
    `Causa provável: ${causaTexto}.\n\n` +
    'Acesse o dashboard para ver o diagnóstico completo.'
  );
}

module.exports = { alertaMargemCaindo };
