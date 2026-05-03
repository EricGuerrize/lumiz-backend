const transactionController = require('../controllers/transactionController');

class SimulatorService {
  async runScenario(userId, { extraRevenue = 0, cutExpensePct = 0, newFixedCost = 0, month, year } = {}) {
    const now = new Date();
    const m = month || now.getMonth() + 1;
    const y = year || now.getFullYear();

    const report = await transactionController.getMonthlyReport(userId, y, m);
    const balance = await transactionController.getBalance(userId);

    const baseEntradas = report.entradas || 0;
    const baseSaidas = report.saidas || 0;
    const baseSaldo = balance.saldo || 0;

    const projEntradas = baseEntradas + extraRevenue;
    const projSaidas = baseSaidas * (1 - Math.min(cutExpensePct, 100) / 100) + newFixedCost;
    const projLucro = projEntradas - projSaidas;
    const projSaldo = baseSaldo + (projLucro - (baseEntradas - baseSaidas));

    const deltaLucro = projLucro - (baseEntradas - baseSaidas);
    const margemAtual = baseEntradas > 0 ? ((baseEntradas - baseSaidas) / baseEntradas) * 100 : 0;
    const margemProjetada = projEntradas > 0 ? (projLucro / projEntradas) * 100 : 0;

    return {
      baseline: {
        entradas: baseEntradas,
        saidas: baseSaidas,
        lucro: baseEntradas - baseSaidas,
        margem: parseFloat(margemAtual.toFixed(1)),
        saldo: baseSaldo,
      },
      scenario: {
        extraRevenue,
        cutExpensePct,
        newFixedCost,
      },
      projection: {
        entradas: projEntradas,
        saidas: projSaidas,
        lucro: projLucro,
        margem: parseFloat(margemProjetada.toFixed(1)),
        saldo: projSaldo,
        deltaLucro,
        impactoPercentual: baseEntradas > 0 ? parseFloat(((deltaLucro / baseEntradas) * 100).toFixed(1)) : 0,
      },
    };
  }
}

module.exports = new SimulatorService();
