const PDFDocument = require('pdfkit');
const supabase = require('../db/supabase');
const transactionController = require('../controllers/transactionController');
const { formatarMoeda } = require('../utils/currency');
const featureFlagService = require('./featureFlagService');
const alterRecebiveisService = require('./alter/alterRecebiveisService');
const coberturaFornecedorService = require('./alter/coberturaFornecedorService');
const healthScoreService = require('./healthScoreService');

const COL_TEXT = '#0A0A0F';
const COL_MUTED = '#71717A';
const COL_TEAL = '#0F766E';
const COL_LINE = '#E5E7EB';
const COL_ROW = '#F4F4F5';

class PdfService {
  _shortDisplayName(nomeCompleto) {
    if (!nomeCompleto || !String(nomeCompleto).trim()) return '';
    const parts = String(nomeCompleto).trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
  }

  _prevMonth(year, month) {
    let m = month - 1;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    return { year: y, month: m };
  }

  /**
   * Agrupa saídas por categoria em buckets estilo DRE (melhor esforço a partir do ledger).
   */
  _bucketCustos(porCategoria) {
    const b = {
      maquininha: 0,
      cmv: 0,
      pessoal: 0,
      aluguel_util: 0,
      outros: 0
    };
    for (const [cat, data] of Object.entries(porCategoria || {})) {
      if (data.tipo !== 'saida') continue;
      const k = String(cat).toLowerCase();
      const v = Number(data.total) || 0;
      if (/mdr|maquin|taxa.*cart|taxas|cielo|stone|rede|getnet|pagseg|adquirente/.test(k)) {
        b.maquininha += v;
      } else if (/insumo|cmv|material|farmacia|farmácia|curva|consumo/.test(k)) {
        b.cmv += v;
      } else if (/salario|salário|folha|pessoal|comiss|colaborador|pró|pro labore|prolabore/.test(k)) {
        b.pessoal += v;
      } else if (/aluguel|condom|luz|energia|água|agua|gás|gas|internet|utilidade/.test(k)) {
        b.aluguel_util += v;
      } else {
        b.outros += v;
      }
    }
    return b;
  }

  _pctDelta(cur, prev) {
    if (!Number.isFinite(prev) || prev === 0) return null;
    return (((cur - prev) / prev) * 100).toFixed(1).replace('.', ',');
  }

  async _alterSnapshot(userId) {
    const enabled = await featureFlagService.isEnabled('alter_enabled', userId);
    if (!enabled) return null;
    try {
      const today = new Date();
      const to = new Date(today.getTime() + 180 * 86400000);
      const fromStr = today.toISOString().split('T')[0];
      const toStr = to.toISOString().split('T')[0];
      const rows = await alterRecebiveisService.list(userId, { from: fromStr, to: toStr });
      let total180 = 0;
      for (const r of rows || []) {
        if (!['livre', 'comprometido'].includes(r.status)) continue;
        total180 += parseFloat(r.valor_liquido) || 0;
      }
      const cob = await coberturaFornecedorService.calcular(userId, { horizonte_dias: 90 });
      const cobPctDisplay =
        cob.total_a_pagar > 0 && Number.isFinite(cob.cobertura_global_pct)
          ? `${Math.min(999, Math.round((cob.cobertura_global_pct || 0) * 100))}%`
          : null;
      let health = null;
      try {
        health = await healthScoreService.getScore(userId);
      } catch (_e) {
        health = null;
      }
      const score1000 = health && Number.isFinite(health.score)
        ? Math.min(1000, Math.round((health.score / 110) * 1000))
        : null;
      return { total180, cobPctDisplay, score1000 };
    } catch (e) {
      console.warn('[PDF] Alter snapshot omitido:', e.message);
      return null;
    }
  }

  _drawDreRow(doc, x, y, w, label, value, { strong = false } = {}) {
    const h = strong ? 18 : 14;
    doc.font(strong ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(strong ? 10.5 : 10)
      .fillColor(COL_TEXT)
      .text(label, x, y, { width: w * 0.62 });
    doc.font(strong ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(strong ? 10.5 : 10)
      .fillColor(COL_TEXT)
      .text(value, x + w * 0.58, y, { width: w * 0.4, align: 'right' });
    doc.moveTo(x, y + h - 2)
      .lineTo(x + w, y + h - 2)
      .strokeColor(COL_ROW)
      .lineWidth(0.35)
      .stroke();
    return y + h;
  }

  /**
   * Gera PDF do relatório mensal (layout estilo relatório do sócio: cabeçalho, resumo, DRE).
   */
  async generateMonthlyReportPDF(userId, year, month) {
    try {
      const report = await transactionController.getMonthlyReport(userId, year, month);
      const { year: py, month: pm } = this._prevMonth(year, month);
      let prevReport = { entradas: 0, saidas: 0 };
      try {
        prevReport = await transactionController.getMonthlyReport(userId, py, pm);
      } catch (_e) {
        prevReport = { entradas: 0, saidas: 0 };
      }

      const { data: user } = await supabase
        .from('profiles')
        .select('nome_completo, nome_clinica')
        .eq('id', userId)
        .single();

      const entradas = report.entradas || 0;
      const saidas = report.saidas || 0;
      const lucro = entradas - saidas;
      const margemPercentual = entradas > 0 ? ((lucro / entradas) * 100).toFixed(1).replace('.', ',') : '0,0';

      const mesTitulo = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', {
        month: 'long',
        year: 'numeric'
      });
      const mesTituloCap = mesTitulo.charAt(0).toUpperCase() + mesTitulo.slice(1);
      const geradoEm = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

      const nomeSocio = this._shortDisplayName(user?.nome_completo);
      const clinica = user?.nome_clinica || 'Clínica';
      const sublinha = nomeSocio ? `${clinica} · ${nomeSocio}` : clinica;

      const prevLucro = (prevReport.entradas || 0) - (prevReport.saidas || 0);
      const dRec = this._pctDelta(entradas, prevReport.entradas || 0);
      const dLuc = this._pctDelta(lucro, prevLucro);
      const mesPrevNome = new Date(py, pm - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
      const variacao =
        dRec != null && dLuc != null
          ? `${dRec.startsWith('-') ? '' : '+'}${dRec}% receita · ${dLuc.startsWith('-') ? '' : '+'}${dLuc}% lucro vs ${mesPrevNome}`
          : null;

      const buckets = this._bucketCustos(report.porCategoria);
      const alter = await this._alterSnapshot(userId);

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 48, bottom: 48, left: 56, right: 56 }
      });

      const buffers = [];
      doc.on('data', (c) => buffers.push(c));

      const pageW = doc.page.width - 112;
      const left = 56;
      let y = 48;

      // Cabeçalho (duas colunas)
      doc.font('Helvetica-Bold', 22).fillColor(COL_TEXT).text('Lumiz', left, y);
      doc.font('Helvetica', 9.5).fillColor(COL_MUTED).text(sublinha, left, y + 26, { width: pageW * 0.55 });

      const headRight = `Relatório mensal\n${mesTituloCap}\nGerado ${geradoEm}`;
      doc.font('Helvetica', 9).fillColor(COL_MUTED).text(headRight, left + pageW * 0.48, y, {
        width: pageW * 0.52,
        align: 'right'
      });

      y += 62;
      doc.moveTo(left, y).lineTo(left + pageW, y).strokeColor(COL_LINE).lineWidth(0.5).stroke();
      y += 22;

      // Resumo
      doc.font('Helvetica-Bold', 8).fillColor(COL_MUTED).text('RESUMO', left, y);
      y += 14;
      doc.font('Helvetica-Bold', 15).fillColor(COL_TEXT).text(
        `Receita ${formatarMoeda(entradas)} · Lucro ${formatarMoeda(lucro)}`,
        left,
        y,
        { width: pageW, lineGap: 2 }
      );
      y += 28;
      if (variacao) {
        doc.font('Helvetica', 10).fillColor(COL_MUTED).text(variacao, left, y, { width: pageW });
        y += 18;
      }

      y += 10;
      doc.font('Helvetica-Bold', 8).fillColor(COL_MUTED).text('DRE SIMPLIFICADO', left, y);
      y += 16;

      y = this._drawDreRow(doc, left, y, pageW, 'Receita bruta', formatarMoeda(entradas));
      if (buckets.maquininha > 0) {
        y = this._drawDreRow(doc, left, y, pageW, '(–) Taxas maquininha', formatarMoeda(buckets.maquininha));
      }
      if (buckets.cmv > 0) {
        y = this._drawDreRow(doc, left, y, pageW, '(–) CMV', formatarMoeda(buckets.cmv));
      }
      if (buckets.pessoal > 0) {
        y = this._drawDreRow(doc, left, y, pageW, '(–) Pessoal', formatarMoeda(buckets.pessoal));
      }
      if (buckets.aluguel_util > 0) {
        y = this._drawDreRow(doc, left, y, pageW, '(–) Aluguel + utilidades', formatarMoeda(buckets.aluguel_util));
      }
      if (buckets.outros > 0) {
        y = this._drawDreRow(doc, left, y, pageW, '(–) Demais custos', formatarMoeda(buckets.outros));
      }
      const custosDre =
        buckets.maquininha + buckets.cmv + buckets.pessoal + buckets.aluguel_util + buckets.outros;
      if (custosDre < saidas - 0.01) {
        y = this._drawDreRow(doc, left, y, pageW, '(–) Outros (agregado)', formatarMoeda(saidas - custosDre));
      }
      y = this._drawDreRow(doc, left, y, pageW, '(=) Lucro líquido', formatarMoeda(lucro), { strong: true });
      y = this._drawDreRow(doc, left, y, pageW, 'Margem', `${margemPercentual}%`, { strong: true });

      y += 14;
      if (alter && (alter.total180 > 0 || alter.cobPctDisplay != null || alter.score1000 != null)) {
        doc.font('Helvetica-Bold', 8).fillColor(COL_TEAL).text('RECEBÍVEIS & COBERTURA · ALTER', left, y);
        y += 16;
        if (alter.total180 > 0) {
          y = this._drawDreRow(doc, left, y, pageW, 'Total agendado 180d', formatarMoeda(alter.total180));
        }
        if (alter.cobPctDisplay != null) {
          y = this._drawDreRow(doc, left, y, pageW, 'Cobertura de fornecedor', alter.cobPctDisplay);
        }
        if (alter.score1000 != null) {
          y = this._drawDreRow(doc, left, y, pageW, 'Score de saúde', `${alter.score1000} / 1.000`);
        }
      }

      // Movimentações (compacto)
      if (report.transacoes && report.transacoes.length > 0) {
        y += 16;
        if (y > 680) {
          doc.addPage();
          y = 48;
        }
        doc.font('Helvetica-Bold', 8).fillColor(COL_MUTED).text('PRINCIPAIS LANÇAMENTOS', left, y);
        y += 14;
        doc.font('Helvetica', 8).fillColor(COL_MUTED);
        for (const t of report.transacoes.slice(0, 12)) {
          if (y > 720) {
            doc.addPage();
            y = 48;
          }
          const valor = parseFloat(t.amount || 0);
          let dataStr = '--/--';
          if (t.date) {
            const d = new Date(t.date);
            if (!isNaN(d.getTime())) dataStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
          }
          const linha = `${dataStr}  ${t.type === 'entrada' ? 'Receita' : 'Custo'}  ${t.categories?.name || t.category || '—'}  ${formatarMoeda(valor)}`;
          doc.text(linha, left, y, { width: pageW });
          y += 12;
        }
      }

      const range = doc.bufferedPageRange();
      const totalPages = range.count;
      for (let i = 0; i < totalPages; i += 1) {
        doc.switchToPage(i);
        doc.font('Helvetica', 7.5)
          .fillColor(COL_MUTED)
          .text(
            `Lumiz · Gerado em ${new Date().toLocaleString('pt-BR')} · Página ${i + 1}/${totalPages}`,
            left,
            doc.page.height - 40,
            { width: pageW, align: 'center' }
          );
      }

      doc.end();

      return new Promise((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);
      });
    } catch (error) {
      console.error('[PDF] Erro ao gerar PDF:', error);
      throw error;
    }
  }
}

module.exports = new PdfService();
