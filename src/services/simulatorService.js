const transactionController = require('../controllers/transactionController');

/** Presets Lumiz-only (PDF §8): defaults documented; override via query na rota. */
const PRESET_DEFAULTS = {
  extra_staff: { newFixedCost: 3500, label: 'Contratar funcionária(o) — custo fixo mensal estimado' },
  price_hike: { priceHikePct: 5, label: 'Aumento de preço médio — % sobre receita do mês baseline' },
  second_room: { newFixedCost: 2000, label: 'Segunda sala — aluguel/custo fixo extra mensal estimado' },
};

class SimulatorService {
  /**
   * Cenários nomeados mapeiam para `runScenario` (retrocompatível com o simulador base).
   * @param {'extra_staff'|'price_hike'|'second_room'} scenarioId
   * @param {{ staffMonthlyCost?: number, priceHikePct?: number, rentExtra?: number }} [overrides]
   */
  async runScenarioPreset(userId, scenarioId, { month, year, staffMonthlyCost, priceHikePct, rentExtra } = {}) {
    const id = String(scenarioId || '').toLowerCase();
    const now = new Date();
    const m = month || now.getMonth() + 1;
    const y = year || now.getFullYear();
    const report = await transactionController.getMonthlyReport(userId, y, m);
    const baseEntradas = report.entradas || 0;

    let extraRevenue = 0;
    let cutExpensePct = 0;
    let newFixedCost = 0;
    let presetKey = id;
    let inputsUsados = {};

    if (id === 'extra_staff') {
      const cost = Number.isFinite(Number(staffMonthlyCost)) ? Number(staffMonthlyCost) : PRESET_DEFAULTS.extra_staff.newFixedCost;
      newFixedCost = Math.min(Math.max(cost, 0), 1_000_000);
      inputsUsados = { staff_monthly_cost: newFixedCost };
    } else if (id === 'price_hike') {
      const pctRaw = priceHikePct != null ? Number(priceHikePct) : PRESET_DEFAULTS.price_hike.priceHikePct;
      const pct = Math.min(Math.max(Number.isFinite(pctRaw) ? pctRaw : 5, 0), 100);
      extraRevenue = Math.min(baseEntradas * (pct / 100), 1_000_000);
      inputsUsados = { price_hike_pct: pct };
    } else if (id === 'second_room') {
      const rent = Number.isFinite(Number(rentExtra)) ? Number(rentExtra) : PRESET_DEFAULTS.second_room.newFixedCost;
      newFixedCost = Math.min(Math.max(rent, 0), 1_000_000);
      inputsUsados = { rent_extra: newFixedCost };
    } else {
      const err = new Error(`Cenário desconhecido: ${scenarioId}`);
      err.code = 'UNKNOWN_SCENARIO';
      throw err;
    }

    const result = await this.runScenario(userId, {
      extraRevenue,
      cutExpensePct,
      newFixedCost,
      month: m,
      year: y,
    });

    return {
      preset: presetKey,
      titulo: PRESET_DEFAULTS[presetKey]?.label || presetKey,
      inputsUsados,
      ...result,
    };
  }

  /**
   * Executa os três presets com os mesmos month/year e overrides opcionais.
   */
  async runAllPresets(userId, { month, year, staffMonthlyCost, priceHikePct, rentExtra } = {}) {
    const now = new Date();
    const m = month || now.getMonth() + 1;
    const y = year || now.getFullYear();
    const ids = ['extra_staff', 'price_hike', 'second_room'];
    const cenários = [];
    for (const id of ids) {
      cenários.push(
        await this.runScenarioPreset(userId, id, {
          month: m,
          year: y,
          staffMonthlyCost,
          priceHikePct,
          rentExtra,
        })
      );
    }
    return {
      month: m,
      year: y,
      defaults: PRESET_DEFAULTS,
      cenários,
    };
  }

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
