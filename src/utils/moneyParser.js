function normalizeText(value) {
  return String(value || '');
}

function parseBrazilianNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  if (!value) return null;
  const cleaned = value.replace(/\./g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
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
  extractInstallments,
  extractMonetaryCandidates,
  extractPrimaryMonetaryValue,
  recoverValueWithInstallmentsContext,
  hasInstallmentPattern
};
