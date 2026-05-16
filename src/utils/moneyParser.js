function normalizeText(value) {
  return String(value || '');
}

function normalizeComparableText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parseBrazilianNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  if (!value) return null;
  // "2.5" or "2.50" → dot is decimal separator (1-2 digits after dot)
  // "1.500" or "1.500.000" → dot is thousands separator (3 digits after each dot)
  const isDecimalDot = /^\d+\.\d{1,2}$/.test(value);
  const cleaned = isDecimalDot
    ? value.replace(',', '.')
    : value.replace(/\./g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractThousandWordValue(text) {
  const raw = normalizeText(text);
  const milMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*mil\b/i);
  if (!milMatch || !milMatch[1]) return null;
  const base = parseBrazilianNumber(milMatch[1]);
  if (!Number.isFinite(base) || base <= 0) return null;
  return base * 1000;
}

function extractKValueCandidates(text) {
  const raw = normalizeText(text);
  const matches = [];
  const regex = /(\d+(?:[.,]\d+)?)\s*k\b/gi;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const base = parseBrazilianNumber(match[1]);
    if (Number.isFinite(base) && base > 0) {
      matches.push(base * 1000);
    }
  }
  return matches;
}

function parsePortugueseNumberPhrase(phrase) {
  const normalized = normalizeComparableText(phrase)
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  const units = {
    zero: 0,
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
    onze: 11,
    doze: 12,
    treze: 13,
    catorze: 14,
    quatorze: 14,
    quinze: 15,
    dezesseis: 16,
    dezassete: 17,
    dezessete: 17,
    dezoito: 18,
    dezenove: 19
  };

  const tens = {
    vinte: 20,
    trinta: 30,
    quarenta: 40,
    cinquenta: 50,
    sessenta: 60,
    setenta: 70,
    oitenta: 80,
    noventa: 90
  };

  const hundreds = {
    cem: 100,
    cento: 100,
    duzentos: 200,
    trezentos: 300,
    quatrocentos: 400,
    quinhentos: 500,
    seiscentos: 600,
    setecentos: 700,
    oitocentos: 800,
    novecentos: 900
  };

  const tokens = normalized.split(' ').filter(Boolean);
  let total = 0;
  let current = 0;

  for (const token of tokens) {
    if (token === 'e') continue;
    if (Object.prototype.hasOwnProperty.call(units, token)) {
      current += units[token];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(tens, token)) {
      current += tens[token];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(hundreds, token)) {
      current += hundreds[token];
      continue;
    }
    if (token === 'mil') {
      total += (current || 1) * 1000;
      current = 0;
      continue;
    }
    if (token === 'milhao' || token === 'milhoes') {
      total += (current || 1) * 1000000;
      current = 0;
      continue;
    }
    return null;
  }

  const value = total + current;
  return value > 0 ? value : null;
}

function extractPortugueseNumberWordValue(text) {
  const normalized = normalizeComparableText(text);
  if (!normalized) return null;

  const numberWordPattern = '(?:zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezassete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos|milhao|milhoes)';
  const milEMeioRegex = new RegExp(`((?:${numberWordPattern})(?:\\s+(?:${numberWordPattern}|e))*)\\s+mil\\s+e\\s+mei[ao]\\b`);
  const milEMeioMatch = normalized.match(milEMeioRegex);
  if (milEMeioMatch && milEMeioMatch[1]) {
    const base = parsePortugueseNumberPhrase(milEMeioMatch[1]);
    if (Number.isFinite(base) && base > 0) {
      return (base * 1000) + 500;
    }
  }

  const phraseMatches = normalized.match(new RegExp(`(?:${numberWordPattern}|mil|e)+(?:\\s+(?:${numberWordPattern}|mil|e)+)*`, 'g'));

  if (!phraseMatches) return null;

  let best = null;
  for (const phrase of phraseMatches) {
    const value = parsePortugueseNumberPhrase(phrase);
    if (Number.isFinite(value) && value > 0) {
      best = Math.max(best || 0, value);
    }
  }

  return best;
}

function hasInstallmentPattern(text) {
  return /\b\d{1,2}\s*x\b/i.test(normalizeText(text)) || /\bem\s+\d{1,2}\s*x\b/i.test(normalizeText(text));
}

function extractInstallments(text) {
  const raw = normalizeText(text);
  const directMatch = raw.match(/\b(\d{1,2})\s*x\b/i);
  if (directMatch && directMatch[1]) {
    const value = parseInt(directMatch[1], 10);
    return Number.isFinite(value) ? value : null;
  }

  const emMatch = raw.match(/\bem\s+(\d{1,2})\s*x\b/i);
  if (emMatch && emMatch[1]) {
    const value = parseInt(emMatch[1], 10);
    return Number.isFinite(value) ? value : null;
  }

  const vezesMatch = raw.match(/\b(?:em\s+)?(\d{1,2})\s*(?:vezes|parcela(?:s)?)\b/i);
  if (vezesMatch && vezesMatch[1]) {
    const value = parseInt(vezesMatch[1], 10);
    return Number.isFinite(value) ? value : null;
  }

  // Jargão financeiro: "30/60/90/120" ou "30/60" (dias de vencimento = parcelas)
  // Cada segmento deve ser > 12 para não confundir com datas (dd/mm)
  const slashMatches = raw.match(/\b\d{1,3}(?:\/\d{1,3})+\b/g);
  if (slashMatches) {
    for (const match of slashMatches) {
      const parts = match.split('/').map(Number);
      const allAbove12 = parts.every(v => v > 12);
      const ascending = parts.every((v, i) => i === 0 || v > parts[i - 1]);
      if (allAbove12 && ascending && parts.length >= 2) {
        return parts.length;
      }
    }
  }

  return null;
}

/**
 * Detecta padrão de dias de vencimento de boleto parcelado (ex: "30/60/90/120")
 * e retorna o array de dias, ou null se não encontrado.
 * @param {string} text
 * @returns {number[]|null}
 */
function extractInstallmentDays(text) {
  const raw = normalizeText(text);
  const slashMatches = raw.match(/\b\d{1,3}(?:\/\d{1,3})+\b/g);
  if (slashMatches) {
    for (const match of slashMatches) {
      const parts = match.split('/').map(Number);
      const allAbove12 = parts.every(v => v > 12);
      const ascending = parts.every((v, i) => i === 0 || v > parts[i - 1]);
      if (allAbove12 && ascending && parts.length >= 2) {
        return parts;
      }
    }
  }
  return null;
}

/**
 * Calcula datas de vencimento de boleto parcelado somando dias corridos à data base.
 * @param {string|Date} dataBase - Data base (string ISO ou objeto Date)
 * @param {number[]} dias - Array de dias corridos, ex: [30, 60, 90, 120]
 * @returns {string[]|null} - Array de datas no formato YYYY-MM-DD, ou null
 */
function calcularVencimentosBoleto(dataBase, dias) {
  if (!Array.isArray(dias) || !dias.length) return null;
  const base = dataBase instanceof Date ? dataBase : new Date(dataBase + 'T12:00:00');
  if (isNaN(base.getTime())) return null;
  return dias.map(d => {
    const dt = new Date(base);
    dt.setDate(dt.getDate() + d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
}

function isLikelyDateToken(rawText, start, end) {
  const before = rawText.slice(Math.max(0, start - 4), start);
  const after = rawText.slice(end, Math.min(rawText.length, end + 4));

  if (/[/-]$/.test(before) || /^[/-]/.test(after)) return true;
  if (/^\s*(de|\/)\s*/i.test(after)) return true;

  return false;
}

function isLikelyYearToken(rawText, start, end, parsedValue) {
  if (!Number.isFinite(parsedValue) || parsedValue < 1900 || parsedValue > 2100) return false;

  const before = rawText.slice(Math.max(0, start - 12), start).toLowerCase();
  const after = rawText.slice(end, Math.min(rawText.length, end + 12)).toLowerCase();

  // Examples: "em 2026", "ano 2026", "de 2026"
  if (/\b(em|ano|de)\s*$/.test(before)) return true;
  // Examples: "2026-02-09", "2026/02/09"
  if (/^\s*[-/]\s*\d{1,2}/.test(after)) return true;

  return false;
}

function extractMonetaryCandidates(text) {
  const raw = normalizeText(text);
  const candidates = [];

  const milValue = extractThousandWordValue(raw);
  if (milValue && milValue > 0) {
    candidates.push({ value: milValue, source: 'thousand_word' });
  }

  extractKValueCandidates(raw).forEach((value) => {
    candidates.push({ value, source: 'k_suffix' });
  });

  const extensoValue = extractPortugueseNumberWordValue(raw);
  if (extensoValue && extensoValue > 0) {
    candidates.push({ value: extensoValue, source: 'number_words' });
  }

  // Alt 1: formatted with at least one thousands separator (ex: "2.800", "1.234,56")
  // Alt 2: plain integer or decimal (ex: "2800", "150.50") — must come after alt1 check
  const moneyRegex = /r\$\s*([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)/gi;
  let moneyMatch;
  while ((moneyMatch = moneyRegex.exec(raw)) !== null) {
    const parsed = parseBrazilianNumber(moneyMatch[1]);
    if (parsed && parsed > 0) {
      candidates.push({ value: parsed, source: 'currency' });
    }
  }

  const numberRegex = /(\d+(?:[.,]\d+)?)/g;
  let numberMatch;
  while ((numberMatch = numberRegex.exec(raw)) !== null) {
    const numberText = numberMatch[1];
    const start = numberMatch.index;
    const end = start + numberText.length;
    const tail = raw.slice(end, end + 3);

    if (/^\s*x\b/i.test(tail)) continue; // 3x, 10x etc.
    if (/^\s*k\b/i.test(tail)) continue; // 15k, 1,5k etc.
    if (isLikelyDateToken(raw, start, end)) continue; // 15/02, 02-03 etc.
    if (/^\d{7,}$/.test(numberText)) continue; // IDs longos/códigos

    const parsed = parseBrazilianNumber(numberText);
    if (!parsed || parsed <= 0) continue;
    if (isLikelyYearToken(raw, start, end, parsed)) continue;

    candidates.push({ value: parsed, source: 'generic' });
  }

  return candidates;
}

function detectMixedPaymentIntent(text) {
  const normalized = normalizeComparableText(text);
  if (!normalized) return false;

  const hasHalf = normalized.includes('metade') || normalized.includes('meio a meio') || normalized.includes('50/50');
  const hasRemainder = normalized.includes('resto') || normalized.includes('restante');
  const hasCashLike = normalized.includes('pix') || normalized.includes('dinheiro') || normalized.includes('especie');
  const hasCardLike = normalized.includes('cartao') || normalized.includes('credito') || normalized.includes('debito') || /\b\d{1,2}\s*x\b/.test(normalized);

  return (hasHalf && hasCashLike && hasCardLike) || (hasRemainder && hasCardLike) || (hasCashLike && hasCardLike && /\+/.test(normalized));
}

function inferPaymentMethodFromContext(normalized, installments) {
  if (normalized.includes('pix')) return 'pix';
  if (normalized.includes('dinheiro') || normalized.includes('especie')) return 'dinheiro';
  if (normalized.includes('debito')) return 'debito';
  if (normalized.includes('cartao') || normalized.includes('credito')) {
    return installments && installments > 1 ? 'parcelado' : 'credito_avista';
  }
  return null;
}

function buildSplitPart(method, value, installments = null) {
  if (!method || !Number.isFinite(value) || value <= 0) return null;
  return {
    metodo: method,
    valor: value,
    parcelas: method === 'parcelado' ? (installments || null) : null
  };
}

function extractMixedPaymentSplit(text, totalValue = null) {
  const normalized = normalizeComparableText(text);
  if (!detectMixedPaymentIntent(normalized)) return null;

  const installments = extractInstallments(normalized);
  const explicitTotal = extractPrimaryMonetaryValue(text);
  const total = Number(totalValue) > 0 ? Number(totalValue) : explicitTotal;
  const cardMethod = installments && installments > 1 ? 'parcelado' : 'credito_avista';

  const splitParts = [];

  // Pattern 1: metade ... metade ...
  if (total && (normalized.includes('metade') || normalized.includes('meio a meio') || normalized.includes('50/50'))) {
    const half = Number((total / 2).toFixed(2));
    const hasPixOrCash = normalized.includes('pix') || normalized.includes('dinheiro') || normalized.includes('especie');
    const hasCard = normalized.includes('cartao') || normalized.includes('credito') || normalized.includes('debito') || installments;

    if (hasPixOrCash && hasCard) {
      const cashMethod = normalized.includes('pix') ? 'pix' : 'dinheiro';
      splitParts.push(buildSplitPart(cashMethod, half));
      splitParts.push(buildSplitPart(cardMethod, Number((total - half).toFixed(2)), installments));
    }
  }

  // Pattern 2: "3000 pix + resto 6x cartao"
  if (!splitParts.length && total) {
    const leftAmountMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:no|em)?\s*(pix|dinheiro|especie)/i);
    if (leftAmountMatch) {
      const leftValue = parseBrazilianNumber(leftAmountMatch[1]);
      const leftMethod = inferPaymentMethodFromContext(leftAmountMatch[2], installments) || 'pix';
      if (leftValue && leftValue > 0 && leftValue < total && (normalized.includes('resto') || normalized.includes('restante') || /\+\s*\d{1,2}\s*x/.test(normalized))) {
        splitParts.push(buildSplitPart(leftMethod, leftValue));
        splitParts.push(buildSplitPart(cardMethod, Number((total - leftValue).toFixed(2)), installments));
      }
    }
  }

  // Pattern 3: explicit two methods with plus and values
  if (!splitParts.length && total) {
    const cashMatch = normalized.match(/(pix|dinheiro|especie)\s*(?:de)?\s*(\d+(?:[.,]\d+)?)/i) || normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:de)?\s*(pix|dinheiro|especie)/i);
    const cardMatch = normalized.match(/(cartao|credito|debito)\s*(?:de)?\s*(\d+(?:[.,]\d+)?)/i) || normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:de)?\s*(cartao|credito|debito)/i);

    if (cashMatch && cardMatch) {
      const cashRaw = cashMatch[2] || cashMatch[1];
      const cardRaw = cardMatch[2] || cardMatch[1];
      const cashValue = parseBrazilianNumber(cashRaw);
      const cardValue = parseBrazilianNumber(cardRaw);
      if (cashValue && cardValue) {
        splitParts.push(buildSplitPart(normalized.includes('pix') ? 'pix' : 'dinheiro', cashValue));
        splitParts.push(buildSplitPart(cardMethod, cardValue, installments));
      }
    }
  }

  // Pattern 4: mixed detected but without explicit total yet
  if (!splitParts.length && !total) {
    const hasPix = normalized.includes('pix');
    const hasCash = normalized.includes('dinheiro') || normalized.includes('especie');
    const hasCard = normalized.includes('cartao') || normalized.includes('credito') || normalized.includes('debito');

    if ((hasPix || hasCash) && hasCard) {
      splitParts.push({ metodo: hasPix ? 'pix' : 'dinheiro', valor: 0, parcelas: null });
      splitParts.push({ metodo: cardMethod, valor: 0, parcelas: cardMethod === 'parcelado' ? (installments || null) : null });
      return {
        total: null,
        splits: splitParts,
        inconsistent: true,
        missingValue: null,
        needsTotal: true
      };
    }
  }

  if (!splitParts.length) return null;

  const sum = splitParts.reduce((acc, part) => acc + (Number(part.valor) || 0), 0);
  const expectedTotal = total || sum;
  const difference = Math.abs(Number((expectedTotal - sum).toFixed(2)));

  if (difference > 0.05) {
    return {
      total: expectedTotal,
      splits: splitParts,
      inconsistent: true,
      missingValue: Number((expectedTotal - sum).toFixed(2))
    };
  }

  return {
    total: expectedTotal,
    splits: splitParts,
    inconsistent: false
  };
}

function extractPrimaryMonetaryValue(text, opts = {}) {
  const candidates = extractMonetaryCandidates(text);
  if (!candidates.length) return null;

  if (!opts.preferHighest) {
    const currency = candidates.filter((item) => item.source === 'currency');
    if (currency.length) {
      return Math.max(...currency.map((item) => item.value));
    }
  }

  return Math.max(...candidates.map((item) => item.value));
}

function recoverValueWithInstallmentsContext(text, currentValue, installments) {
  const fallback = Number(currentValue);
  const extracted = extractPrimaryMonetaryValue(text);

  if (!Number.isFinite(fallback) || fallback <= 0) return extracted;
  if (!Number.isFinite(extracted) || extracted <= 0) return fallback;

  if (installments && fallback <= Number(installments) && extracted > fallback) {
    return extracted;
  }

  if (hasInstallmentPattern(text) && fallback <= 12 && extracted > fallback) {
    return extracted;
  }

  return fallback;
}

module.exports = {
  parseBrazilianNumber,
  extractThousandWordValue,
  extractInstallments,
  extractInstallmentDays,
  calcularVencimentosBoleto,
  extractMonetaryCandidates,
  extractPrimaryMonetaryValue,
  recoverValueWithInstallmentsContext,
  hasInstallmentPattern,
  detectMixedPaymentIntent,
  extractMixedPaymentSplit
};
