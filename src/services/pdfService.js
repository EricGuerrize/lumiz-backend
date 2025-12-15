const PDFDocument = require('pdfkit');
const supabase = require('../db/supabase');
const transactionController = require('../controllers/transactionController');

class PdfService {
  /**
   * Gera PDF do relatório mensal
   */
  async generateMonthlyReportPDF(userId, year, month) {
    try {
      // Busca dados do relatório
      const report = await transactionController.getMonthlyReport(userId, year, month);

      // Busca dados do usuário
      const { data: user } = await supabase
        .from('profiles')
        .select('nome_completo, nome_clinica')
        .eq('id', userId)
        .single();

      const lucro = report.entradas - report.saidas;
      const margemPercentual = report.entradas > 0
        ? ((lucro / report.entradas) * 100).toFixed(1)
        : 0;

      const mesNome = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', {
        month: 'long',
        year: 'numeric'
      });

      // Cria o PDF
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => { });

      // Header
      doc.fontSize(20)
        .fillColor('#6B46C1')
        .text('LUMIZ', 50, 50, { align: 'left' });

      doc.fontSize(10)
        .fillColor('#666')
        .text('Relatório Financeiro Mensal', 50, 75, { align: 'left' });

      // Informações do usuário
      doc.fontSize(14)
        .fillColor('#000')
        .text(`Clínica: ${user?.nome_clinica || 'N/A'}`, 50, 110);

      if (user?.nome_completo) {
        doc.fontSize(12)
          .fillColor('#666')
          .text(`Responsável: ${user.nome_completo}`, 50, 130);
      }

      // Período
      doc.fontSize(16)
        .fillColor('#000')
        .text(`Período: ${mesNome}`, 50, 160, { underline: true });

      // Resumo Financeiro
      let yPos = 200;
      doc.fontSize(14)
        .fillColor('#000')
        .text('RESUMO FINANCEIRO', 50, yPos, { underline: true });

      yPos += 30;
      doc.fontSize(12)
        .fillColor('#000')
        .text(`Faturamento:`, 50, yPos)
        .fillColor('#10B981')
        .text(`R$ ${report.entradas.toFixed(2)}`, 200, yPos, { align: 'right' });

      yPos += 25;
      doc.fillColor('#000')
        .text(`Custos:`, 50, yPos)
        .fillColor('#EF4444')
        .text(`R$ ${report.saidas.toFixed(2)}`, 200, yPos, { align: 'right' });

      yPos += 25;
      doc.fillColor('#000')
        .fontSize(14)
        .text(`Lucro Líquido:`, 50, yPos)
        .fillColor(lucro >= 0 ? '#10B981' : '#EF4444')
        .fontSize(16)
        .text(`R$ ${lucro.toFixed(2)} (${margemPercentual}%)`, 200, yPos, { align: 'right' });

      yPos += 35;
      doc.fontSize(11)
        .fillColor('#666')
        .text(`Total de movimentações: ${report.totalTransacoes}`, 50, yPos);

      // Categorias
      if (Object.keys(report.porCategoria).length > 0) {
        yPos += 40;
        doc.fontSize(14)
          .fillColor('#000')
          .text('PRINCIPAIS CATEGORIAS', 50, yPos, { underline: true });

        yPos += 30;
        const categorias = Object.entries(report.porCategoria)
          .sort((a, b) => b[1].total - a[1].total)
          .slice(0, 10);

        categorias.forEach(([cat, data]) => {
          if (yPos > 700) {
            doc.addPage();
            yPos = 50;
          }


          doc.fontSize(11)
            .fillColor('#000')
            .text(`${data.tipo === 'entrada' ? '(+)' : '(-)'} ${cat}:`, 70, yPos)
            .fillColor(data.tipo === 'entrada' ? '#10B981' : '#EF4444')
            .text(`R$ ${data.total.toFixed(2)}`, 450, yPos, { align: 'right' });

          yPos += 20;
        });
      }

      // Transações detalhadas (se houver espaço)
      if (report.transacoes && report.transacoes.length > 0 && yPos < 650) {
        yPos += 30;
        doc.fontSize(14)
          .fillColor('#000')
          .text('TRANSAÇÕES DETALHADAS', 50, yPos, { underline: true });

        yPos += 30;
        
        // Ordena transações por data (mais recentes primeiro)
        const transacoesOrdenadas = [...report.transacoes].sort((a, b) => {
          const dateA = new Date(a.data || a.date || 0);
          const dateB = new Date(b.data || b.date || 0);
          return dateB - dateA; // Mais recente primeiro
        });
        
        transacoesOrdenadas.slice(0, 15).forEach(t => {
          if (yPos > 700) {
            doc.addPage();
            yPos = 50;
          }

          // Detecta se é atendimento (entrada) ou conta_pagar (saída)
          const isAtendimento = !!t.valor_total; // Atendimentos têm valor_total
          const tipo = isAtendimento ? 'RECEITA' : 'CUSTO';
          const valor = isAtendimento 
            ? parseFloat(t.valor_total || 0)
            : parseFloat(t.valor || 0);

          // Validação de data para evitar "Invalid Date"
          let dataStr = '--/--/----';
          const dataTransacao = t.data || t.date;
          if (dataTransacao) {
            const dateObj = new Date(dataTransacao);
            if (!isNaN(dateObj.getTime())) {
              dataStr = dateObj.toLocaleDateString('pt-BR');
            }
          }

          // Determina categoria
          let categoria = 'Sem categoria';
          if (isAtendimento) {
            // Para atendimentos, pega do procedimento
            categoria = t.atendimento_procedimentos?.[0]?.procedimentos?.nome 
              || t.observacoes?.substring(0, 30)
              || 'Procedimento';
          } else {
            // Para contas a pagar, usa categoria ou descrição
            categoria = t.categoria || t.descricao?.substring(0, 30) || 'Despesa';
          }

          doc.fontSize(9)
            .fillColor('#666')
            .text(dataStr, 50, yPos)
            .fillColor('#000')
            .text(tipo, 120, yPos)
            .text(categoria.substring(0, 30), 200, yPos)
            .fillColor(tipo === 'RECEITA' ? '#10B981' : '#EF4444')
            .text(`R$ ${valor.toFixed(2)}`, 450, yPos, { align: 'right' });

          // Descrição/observações
          const descricao = t.observacoes || t.descricao || '';
          if (descricao) {
            yPos += 12;
            doc.fontSize(8)
              .fillColor('#999')
              .text(descricao.substring(0, 60), 200, yPos);
          }

          yPos += 20;
        });
      }

      // Footer
      const totalPages = doc.bufferedPageRange().count;
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);
        doc.fontSize(8)
          .fillColor('#999')
          .text(
            `Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')} - Página ${i + 1} de ${totalPages}`,
            50,
            doc.page.height - 30,
            { align: 'center' }
          );
      }

      doc.end();

      // Converte para buffer
      return new Promise((resolve, reject) => {
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(buffers);
          resolve(pdfBuffer);
        });
        doc.on('error', reject);
      });
    } catch (error) {
      console.error('[PDF] Erro ao gerar PDF:', error);
      throw error;
    }
  }

}

module.exports = new PdfService();

