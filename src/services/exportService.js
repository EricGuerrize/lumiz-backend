/**
 * Fase 3 + Fase 13 — Export Service.
 *
 * Responsabilidade única: exportar relatório financeiro mensal nos formatos
 * PDF (via `pdfService`), CSV (compatível com Excel/Sheets) e OFX 2.0
 * (compatível com software contábil — Conta Azul, Sage, ContaBilizei, etc.).
 *
 * Dependências externas:
 *   - `pdfService.generateMonthlyReportPDF` para PDF.
 *   - `transactionController.getMonthlyReport` para CSV/OFX (usa
 *     `view_financial_ledger` no Supabase com union de atendimentos +
 *     contas_pagar pagas no mês).
 */

const pdfService = require('./pdfService');
const transactionController = require('../controllers/transactionController');

const TIMEZONE_OFFSET = '[-3:BRT]'; // Brasília, sem DST.
const NAME_MAX = 32;   // Limite OFX 2.0 para <NAME>
const MEMO_MAX = 255;  // Limite OFX 2.0 para <MEMO>

class ExportService {
  /**
   * @param {string|undefined} monthStr formato YYYY-MM
   * @returns {{ year: number, month: number }}
   * @private
   */
  _parseMonth(monthStr) {
    if (!monthStr) {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }
    const [y, m] = monthStr.split('-').map(Number);
    return { year: y, month: m };
  }

  /**
   * Compatibilidade: o controller hoje retorna `transacoes` (PT-BR), mas
   * historicamente o exportCSV iterava `transactions`. Aceita ambos sem
   * quebrar relatórios já gerados.
   * @private
   */
  _extractTransactions(report) {
    if (!report) return [];
    if (Array.isArray(report.transactions)) return report.transactions;
    if (Array.isArray(report.transacoes)) return report.transacoes;
    return [];
  }

  async exportPDF(userId, monthStr) {
    const { year, month } = this._parseMonth(monthStr);
    return pdfService.generateMonthlyReportPDF(userId, year, month);
  }

  async exportCSV(userId, monthStr) {
    const { year, month } = this._parseMonth(monthStr);
    const report = await transactionController.getMonthlyReport(userId, year, month);
    const transacoes = this._extractTransactions(report);

    const rows = [
      ['tipo', 'descricao', 'valor', 'data', 'forma_pagamento', 'categoria'],
    ];

    const escapeCsv = (v) => {
      const s = String(v ?? '');
      if (/[,"\n=+\-@\t]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    for (const t of transacoes) {
      rows.push([
        escapeCsv(t.type || t.tipo),
        escapeCsv(t.description || t.descricao),
        t.amount ?? t.valor ?? 0,
        escapeCsv(t.date || t.data || t.data_evento || t.data_recebimento),
        escapeCsv(t.payment_method || t.forma_pagamento),
        escapeCsv(t.category || t.categoria),
      ]);
    }

    rows.push([]);
    rows.push(['TOTAL ENTRADAS', '', report.entradas || 0, '', '', '']);
    rows.push(['TOTAL SAIDAS', '', report.saidas || 0, '', '', '']);
    rows.push(['LUCRO', '', (report.entradas || 0) - (report.saidas || 0), '', '', '']);

    return rows.map(r => r.join(',')).join('\n');
  }

  /**
   * Fase 13 — Export OFX 2.0 (XML).
   *
   * Formato compatível com:
   *   - Conta Azul, ContaBilizei, Sage, Domínio Contábil
   *   - Microsoft Money, GnuCash (parsers tolerantes)
   *   - Excel via "abrir como texto" (com BOM)
   *
   * Convenções:
   *   - DTPOSTED em meio-dia local (12:00:00) para evitar drift de timezone.
   *   - TRNAMT: positivo para CREDIT, negativo para DEBIT (padrão OFX).
   *   - FITID prefixado com `E` (entrada) ou `S` (saída) para garantir
   *     unicidade global (entradas e saídas vêm de tabelas distintas).
   *   - NAME truncado a 32 chars, MEMO a 255 chars (limites OFX 2.0).
   *   - LEDGERBAL = entradas - saídas (saldo do período, não o saldo geral).
   *   - BANKID `LUMIZ`, ACCTID `LUMIZ-<sufixo userId>`, ACCTTYPE CHECKING.
   *
   * @param {string} userId
   * @param {string|undefined} monthStr YYYY-MM
   * @returns {Promise<string>} OFX como string com BOM UTF-8 já incluído.
   */
  async exportOFX(userId, monthStr) {
    const { year, month } = this._parseMonth(monthStr);
    const report = await transactionController.getMonthlyReport(userId, year, month);
    const transacoes = this._extractTransactions(report);

    const lastDay = new Date(year, month, 0).getDate();
    const dtStart = this._formatOfxDate(new Date(year, month - 1, 1, 12, 0, 0));
    const dtEnd = this._formatOfxDate(new Date(year, month - 1, lastDay, 12, 0, 0));
    const dtServer = this._formatOfxDate(new Date());

    const acctId = this._buildAcctId(userId);
    const stmttrns = transacoes
      .map((t) => this._renderStmtTrn(t))
      .filter(Boolean)
      .join('\n');

    const balAmt = ((report.entradas || 0) - (report.saidas || 0)).toFixed(2);

    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?OFX OFXHEADER="200" VERSION="200" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>',
      '<OFX>',
      '  <SIGNONMSGSRSV1>',
      '    <SONRS>',
      '      <STATUS>',
      '        <CODE>0</CODE>',
      '        <SEVERITY>INFO</SEVERITY>',
      '      </STATUS>',
      `      <DTSERVER>${dtServer}</DTSERVER>`,
      '      <LANGUAGE>POR</LANGUAGE>',
      '      <FI>',
      '        <ORG>Lumiz</ORG>',
      '        <FID>LUMIZ</FID>',
      '      </FI>',
      '    </SONRS>',
      '  </SIGNONMSGSRSV1>',
      '  <BANKMSGSRSV1>',
      '    <STMTTRNRS>',
      '      <TRNUID>1</TRNUID>',
      '      <STATUS>',
      '        <CODE>0</CODE>',
      '        <SEVERITY>INFO</SEVERITY>',
      '      </STATUS>',
      '      <STMTRS>',
      '        <CURDEF>BRL</CURDEF>',
      '        <BANKACCTFROM>',
      '          <BANKID>LUMIZ</BANKID>',
      `          <ACCTID>${this._escapeXml(acctId)}</ACCTID>`,
      '          <ACCTTYPE>CHECKING</ACCTTYPE>',
      '        </BANKACCTFROM>',
      '        <BANKTRANLIST>',
      `          <DTSTART>${dtStart}</DTSTART>`,
      `          <DTEND>${dtEnd}</DTEND>`,
      stmttrns,
      '        </BANKTRANLIST>',
      '        <LEDGERBAL>',
      `          <BALAMT>${balAmt}</BALAMT>`,
      `          <DTASOF>${dtEnd}</DTASOF>`,
      '        </LEDGERBAL>',
      '      </STMTRS>',
      '    </STMTTRNRS>',
      '  </BANKMSGSRSV1>',
      '</OFX>',
      ''
    ].filter(line => line !== '').join('\n');

    return `\uFEFF${body}`;
  }

  /**
   * Renderiza um <STMTTRN>. Retorna `null` se faltarem campos críticos
   * (valor zero ou data inválida) — preserva o arquivo válido mesmo com
   * dados ruins na entrada.
   * @private
   */
  _renderStmtTrn(t) {
    const tipo = (t.type || t.tipo || '').toString().toLowerCase();
    const isEntrada = tipo === 'entrada';
    const valorRaw = Number(t.amount ?? t.valor);
    if (!Number.isFinite(valorRaw) || valorRaw === 0) return null;

    const trnAmt = (isEntrada ? Math.abs(valorRaw) : -Math.abs(valorRaw)).toFixed(2);
    const trnType = isEntrada ? 'CREDIT' : 'DEBIT';

    const dataRaw = t.date || t.data || t.data_evento || t.data_recebimento;
    const dt = this._parseOfxDate(dataRaw);
    if (!dt) return null;
    const dtPosted = this._formatOfxDate(dt);

    const fitidBase = t.id || `${dataRaw}-${trnAmt}-${(t.description || t.descricao || 'tx')}`;
    const fitid = `${isEntrada ? 'E' : 'S'}${String(fitidBase).replace(/[^A-Za-z0-9-]/g, '').slice(0, 254)}`;

    const nameSrc = t.description || t.descricao || t.category || t.categoria || 'Lancamento';
    const memoSrc = t.category || t.categoria || t.payment_method || t.forma_pagamento || '';

    const name = this._escapeXml(this._truncate(nameSrc, NAME_MAX));
    const memo = this._escapeXml(this._truncate(memoSrc, MEMO_MAX));

    const memoLine = memo ? `            <MEMO>${memo}</MEMO>\n` : '';

    return [
      '          <STMTTRN>',
      `            <TRNTYPE>${trnType}</TRNTYPE>`,
      `            <DTPOSTED>${dtPosted}</DTPOSTED>`,
      `            <TRNAMT>${trnAmt}</TRNAMT>`,
      `            <FITID>${this._escapeXml(fitid)}</FITID>`,
      `            <NAME>${name}</NAME>`,
      memoLine + '          </STMTTRN>'
    ].join('\n');
  }

  /**
   * Converte string de data ('YYYY-MM-DD' ou ISO) em Date com hora 12:00
   * local. Retorna null para entradas inválidas.
   * @private
   */
  _parseOfxDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value : null;
    }
    const s = String(value);
    const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymd) {
      const [, yy, mm, dd] = ymd;
      const dt = new Date(Number(yy), Number(mm) - 1, Number(dd), 12, 0, 0);
      return Number.isFinite(dt.getTime()) ? dt : null;
    }
    const dt = new Date(s);
    return Number.isFinite(dt.getTime()) ? dt : null;
  }

  /**
   * Formata Date como `YYYYMMDDHHMMSS[-3:BRT]` (formato OFX 2.0).
   * @private
   */
  _formatOfxDate(dt) {
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const stamp = `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}${pad(dt.getHours())}${pad(dt.getMinutes())}${pad(dt.getSeconds())}`;
    return `${stamp}${TIMEZONE_OFFSET}`;
  }

  /**
   * Trunca string para o limite OFX 2.0 do campo, removendo espaços nas
   * extremidades.
   * @private
   */
  _truncate(str, maxLen) {
    if (str === null || str === undefined) return '';
    const s = String(str).trim();
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen);
  }

  /**
   * Constrói ACCTID estável e curto a partir do userId.
   * @private
   */
  _buildAcctId(userId) {
    const suffix = String(userId || '').replace(/-/g, '').slice(0, 12).toUpperCase();
    return `LUMIZ-${suffix || 'CONTA'}`;
  }

  /**
   * Escape mínimo de XML (`& < > " '`).
   * @private
   */
  _escapeXml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

module.exports = new ExportService();
module.exports.ExportService = ExportService;
