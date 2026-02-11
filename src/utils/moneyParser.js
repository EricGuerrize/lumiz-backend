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
  const cleaned = value.replace(/\./g, '').replace(',', '.');
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

  return null;
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

  const moneyRegex = /r\$\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)/gi;
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
  extractMonetaryCandidates,
  extractPrimaryMonetaryValue,
  recoverValueWithInstallmentsContext,
  hasInstallmentPattern,
  detectMixedPaymentIntent,
  extractMixedPaymentSplit
};
