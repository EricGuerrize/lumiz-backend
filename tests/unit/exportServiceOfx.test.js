/**
 * Fase 13 — exportService.exportOFX(userId, monthStr).
 *
 * Garante:
 *   1. OFX bem-formado (header XML + processing instruction OFX 2.0).
 *   2. BOM UTF-8 no início (Excel / software contábil legacy).
 *   3. CREDIT/DEBIT mapeado corretamente; sinal de TRNAMT respeitado.
 *   4. DTPOSTED em formato OFX `YYYYMMDDHHMMSS[-3:BRT]`.
 *   5. FITID único por transação (prefixo E/S evita colisão entrada↔saída).
 *   6. NAME truncado a 32 chars; MEMO a 255 chars.
 *   7. LEDGERBAL = entradas - saidas.
 *   8. Mês vazio gera OFX válido sem <STMTTRN>.
 *   9. Caracteres XML perigosos escapados.
 */

const path = require('path');

describe('Fase 13 — exportService.exportOFX', () => {
  let exportService;
  let mockGetMonthlyReport;

  beforeEach(() => {
    jest.resetModules();
    mockGetMonthlyReport = jest.fn();
    jest.doMock('../../src/controllers/transactionController', () => ({
      getMonthlyReport: (...args) => mockGetMonthlyReport(...args)
    }));
    jest.doMock('../../src/services/pdfService', () => ({
      generateMonthlyReportPDF: jest.fn()
    }));
    exportService = require('../../src/services/exportService');
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function buildReport(transacoes, totals = {}) {
    return {
      periodo: '5/2026',
      entradas: totals.entradas ?? 0,
      saidas: totals.saidas ?? 0,
      transacoes
    };
  }

  it('inclui BOM UTF-8 e header OFX 2.0', async () => {
    mockGetMonthlyReport.mockResolvedValue(buildReport([]));
    const ofx = await exportService.exportOFX('user-abc', '2026-05');
    expect(ofx.charCodeAt(0)).toBe(0xfeff);
    expect(ofx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(ofx).toContain('OFXHEADER="200"');
    expect(ofx).toContain('VERSION="200"');
    expect(ofx).toContain('<CURDEF>BRL</CURDEF>');
    expect(ofx).toContain('<ACCTTYPE>CHECKING</ACCTTYPE>');
  });

  it('mês vazio: OFX válido sem <STMTTRN> e LEDGERBAL=0.00', async () => {
    mockGetMonthlyReport.mockResolvedValue(buildReport([], { entradas: 0, saidas: 0 }));
    const ofx = await exportService.exportOFX('u1', '2026-05');
    expect(ofx).not.toContain('<STMTTRN>');
    expect(ofx).toMatch(/<DTSTART>20260501120000\[-3:BRT\]<\/DTSTART>/);
    expect(ofx).toMatch(/<DTEND>20260531120000\[-3:BRT\]<\/DTEND>/);
    expect(ofx).toMatch(/<BALAMT>0\.00<\/BALAMT>/);
  });

  it('entrada vira CREDIT com TRNAMT positivo, saída vira DEBIT com sinal negativo', async () => {
    mockGetMonthlyReport.mockResolvedValue(buildReport(
      [
        {
          id: 'a-1',
          type: 'entrada',
          valor: 1500,
          amount: 1500,
          data: '2026-05-10',
          descricao: 'Botox paciente Maria',
          categoria: 'Botox',
          forma_pagamento: 'pix'
        },
        {
          id: 'b-2',
          type: 'saida',
          valor: 320.5,
          amount: 320.5,
          data: '2026-05-20',
          descricao: 'Compra de toxina',
          categoria: 'Insumos',
          forma_pagamento: 'boleto'
        }
      ],
      { entradas: 1500, saidas: 320.5 }
    ));

    const ofx = await exportService.exportOFX('u1', '2026-05');
    const stmttrns = ofx.split('<STMTTRN>').slice(1);
    expect(stmttrns).toHaveLength(2);

    expect(stmttrns[0]).toContain('<TRNTYPE>CREDIT</TRNTYPE>');
    expect(stmttrns[0]).toMatch(/<TRNAMT>1500\.00<\/TRNAMT>/);
    expect(stmttrns[0]).toMatch(/<DTPOSTED>20260510120000\[-3:BRT\]<\/DTPOSTED>/);
    expect(stmttrns[0]).toContain('<NAME>Botox paciente Maria</NAME>');
    expect(stmttrns[0]).toContain('<MEMO>Botox</MEMO>');
    expect(stmttrns[0]).toMatch(/<FITID>Ea-1<\/FITID>/);

    expect(stmttrns[1]).toContain('<TRNTYPE>DEBIT</TRNTYPE>');
    expect(stmttrns[1]).toMatch(/<TRNAMT>-320\.50<\/TRNAMT>/);
    expect(stmttrns[1]).toMatch(/<FITID>Sb-2<\/FITID>/);

    expect(ofx).toMatch(/<BALAMT>1179\.50<\/BALAMT>/);
  });

  it('escapa caracteres XML perigosos em NAME e MEMO', async () => {
    mockGetMonthlyReport.mockResolvedValue(buildReport([
      {
        id: 'x-1',
        type: 'entrada',
        valor: 100,
        amount: 100,
        data: '2026-05-01',
        descricao: 'Cliente <Maria> & "amigos"',
        categoria: 'Procedimento <X>',
        forma_pagamento: 'pix'
      }
    ], { entradas: 100, saidas: 0 }));

    const ofx = await exportService.exportOFX('u1', '2026-05');
    expect(ofx).toContain('<NAME>Cliente &lt;Maria&gt; &amp; &quot;amigos&quot;</NAME>');
    expect(ofx).toContain('<MEMO>Procedimento &lt;X&gt;</MEMO>');
    expect(ofx).not.toContain('<MEMO>Procedimento <X></MEMO>');
  });

  it('truncate é aplicado antes do escape (preserva XML válido)', async () => {
    // 33 chars com `&` no caractere 33 — se escapasse antes do truncate,
    // poderia gerar `&am` quebrado no meio. Truncate primeiro evita isso.
    const desc = 'A'.repeat(32) + '&XYZ';
    mockGetMonthlyReport.mockResolvedValue(buildReport([
      { id: 't', type: 'entrada', valor: 10, amount: 10, data: '2026-05-10', descricao: desc }
    ], { entradas: 10 }));
    const ofx = await exportService.exportOFX('u1', '2026-05');
    expect(ofx).toContain('<NAME>' + 'A'.repeat(32) + '</NAME>');
    expect(ofx).not.toMatch(/<NAME>[^<]*&am[^p]/);
  });

  it('trunca NAME a 32 chars e MEMO a 255 chars', async () => {
    const longName = 'A'.repeat(80);
    const longMemo = 'B'.repeat(400);
    mockGetMonthlyReport.mockResolvedValue(buildReport([
      {
        id: 'x-1',
        type: 'entrada',
        valor: 50,
        amount: 50,
        data: '2026-05-15',
        descricao: longName,
        categoria: longMemo
      }
    ], { entradas: 50, saidas: 0 }));

    const ofx = await exportService.exportOFX('u1', '2026-05');
    const nameMatch = ofx.match(/<NAME>([^<]*)<\/NAME>/);
    const memoMatch = ofx.match(/<MEMO>([^<]*)<\/MEMO>/);
    expect(nameMatch[1]).toHaveLength(32);
    expect(memoMatch[1]).toHaveLength(255);
  });

  it('descarta transações com valor zero ou data inválida', async () => {
    mockGetMonthlyReport.mockResolvedValue(buildReport([
      { id: 'zero', type: 'entrada', valor: 0, amount: 0, data: '2026-05-10' },
      { id: 'ruim', type: 'entrada', valor: 100, amount: 100, data: 'not-a-date' },
      { id: 'ok', type: 'entrada', valor: 200, amount: 200, data: '2026-05-12', descricao: 'Ok' }
    ], { entradas: 200, saidas: 0 }));

    const ofx = await exportService.exportOFX('u1', '2026-05');
    const stmttrns = ofx.split('<STMTTRN>').slice(1);
    expect(stmttrns).toHaveLength(1);
    expect(stmttrns[0]).toContain('<NAME>Ok</NAME>');
  });

  it('FITID prefixa E para entrada e S para saída evitando colisão de UUID compartilhado', async () => {
    mockGetMonthlyReport.mockResolvedValue(buildReport([
      { id: 'shared-uuid', type: 'entrada', valor: 100, amount: 100, data: '2026-05-01' },
      { id: 'shared-uuid', type: 'saida', valor: 100, amount: 100, data: '2026-05-02' }
    ], { entradas: 100, saidas: 100 }));

    const ofx = await exportService.exportOFX('u1', '2026-05');
    const fitids = [...ofx.matchAll(/<FITID>([^<]+)<\/FITID>/g)].map(m => m[1]);
    expect(fitids).toEqual(['Eshared-uuid', 'Sshared-uuid']);
    expect(new Set(fitids).size).toBe(fitids.length);
  });

  it('aceita também o campo legado `transactions` (compat)', async () => {
    mockGetMonthlyReport.mockResolvedValue({
      periodo: '5/2026',
      entradas: 500,
      saidas: 0,
      transactions: [
        { id: 't-1', type: 'entrada', valor: 500, amount: 500, data: '2026-05-05', descricao: 'Legacy' }
      ]
    });
    const ofx = await exportService.exportOFX('u1', '2026-05');
    expect(ofx).toContain('<NAME>Legacy</NAME>');
    expect(ofx).toMatch(/<BALAMT>500\.00<\/BALAMT>/);
  });

  it('ACCTID é determinístico e curto (prefixo LUMIZ + sufixo userId sem hífens)', async () => {
    mockGetMonthlyReport.mockResolvedValue(buildReport([]));
    const ofx = await exportService.exportOFX('11111111-2222-3333-4444-555555555555', '2026-05');
    expect(ofx).toContain('<ACCTID>LUMIZ-111111112222</ACCTID>');
  });
});
