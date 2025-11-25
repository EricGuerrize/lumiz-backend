const XLSX = require('xlsx');
const supabase = require('../db/supabase');
const transactionController = require('../controllers/transactionController');

class ExcelService {
  async generateExcelReport(userId, year = null, month = null) {
    try {
      console.log('[EXCEL] Gerando relatório Excel...');
      console.log('[EXCEL] UserId:', userId);
      console.log('[EXCEL] Year:', year, 'Month:', month);

      const now = new Date();
      const reportYear = year || now.getFullYear();
      const reportMonth = month || (now.getMonth() + 1);

      // Busca relatório mensal
      const report = await transactionController.getMonthlyReport(userId, reportYear, reportMonth);

      // Busca todas as transações do período
      const { data: transactions, error } = await supabase
        .from('atendimentos')
        .select(`
          id,
          valor_total,
          data,
          observacoes,
          forma_pagamento,
          clientes(nome),
          atendimento_procedimentos(
            procedimentos(nome)
          )
        `)
        .eq('user_id', userId)
        .gte('data', `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`)
        .lt('data', `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-01`)
        .order('data', { ascending: false });

      if (error) throw error;

      // Busca contas a pagar
      const { data: contas, error: contasError } = await supabase
        .from('contas_pagar')
        .select('*')
        .eq('user_id', userId)
        .gte('data', `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`)
        .lt('data', `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-01`)
        .order('data', { ascending: false });

      if (contasError) throw contasError;

      // Cria workbook
      const workbook = XLSX.utils.book_new();

      // Sheet 1: Resumo
      const resumoData = [
        ['RELATÓRIO FINANCEIRO'],
        [`Período: ${reportMonth}/${reportYear}`],
        [],
        ['Item', 'Valor'],
        ['Faturamento Total', report.entradas],
        ['Custos Total', report.saidas],
        ['Lucro Líquido', report.entradas - report.saidas],
        ['Margem %', report.entradas > 0 ? (((report.entradas - report.saidas) / report.entradas) * 100).toFixed(2) : '0.00'],
        ['Total de Movimentações', report.totalTransacoes],
      ];

      const resumoSheet = XLSX.utils.aoa_to_sheet(resumoData);
      XLSX.utils.book_append_sheet(workbook, resumoSheet, 'Resumo');

      // Sheet 2: Receitas
      const receitasData = [
        ['Data', 'Cliente', 'Procedimento', 'Valor', 'Forma Pagamento', 'Observações']
      ];

      if (transactions && transactions.length > 0) {
        transactions.forEach(t => {
          const procedimento = t.atendimento_procedimentos?.[0]?.procedimentos?.nome || 'N/A';
          const cliente = t.clientes?.nome || 'N/A';
          receitasData.push([
            new Date(t.data).toLocaleDateString('pt-BR'),
            cliente,
            procedimento,
            parseFloat(t.valor_total || 0),
            t.forma_pagamento || 'N/A',
            t.observacoes || ''
          ]);
        });
      }

      const receitasSheet = XLSX.utils.aoa_to_sheet(receitasData);
      XLSX.utils.book_append_sheet(workbook, receitasSheet, 'Receitas');

      // Sheet 3: Custos
      const custosData = [
        ['Data', 'Categoria', 'Descrição', 'Valor']
      ];

      if (contas && contas.length > 0) {
        contas.forEach(c => {
          custosData.push([
            new Date(c.data).toLocaleDateString('pt-BR'),
            c.categoria || 'N/A',
            c.descricao || '',
            parseFloat(c.valor || 0)
          ]);
        });
      }

      const custosSheet = XLSX.utils.aoa_to_sheet(custosData);
      XLSX.utils.book_append_sheet(workbook, custosSheet, 'Custos');

      // Gera buffer
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      console.log('[EXCEL] ✅ Relatório Excel gerado com sucesso');
      console.log('[EXCEL] Tamanho:', excelBuffer.length, 'bytes');

      return excelBuffer;
    } catch (error) {
      console.error('[EXCEL] ❌ Erro ao gerar Excel:', error);
      throw error;
    }
  }

  async generateCSVReport(userId, year = null, month = null) {
    try {
      console.log('[EXCEL] Gerando relatório CSV...');

      const now = new Date();
      const reportYear = year || now.getFullYear();
      const reportMonth = month || (now.getMonth() + 1);

      // Busca todas as transações
      const { data: transactions, error } = await supabase
        .from('atendimentos')
        .select(`
          valor_total,
          data,
          observacoes,
          forma_pagamento,
          clientes(nome),
          atendimento_procedimentos(
            procedimentos(nome)
          )
        `)
        .eq('user_id', userId)
        .gte('data', `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`)
        .lt('data', `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-01`)
        .order('data', { ascending: false });

      if (error) throw error;

      // Busca contas a pagar
      const { data: contas, error: contasError } = await supabase
        .from('contas_pagar')
        .select('*')
        .eq('user_id', userId)
        .gte('data', `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`)
        .lt('data', `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-01`)
        .order('data', { ascending: false });

      if (contasError) throw contasError;

      // Gera CSV
      let csv = 'Tipo,Data,Cliente/Categoria,Procedimento/Descrição,Valor,Forma Pagamento\n';

      // Receitas
      if (transactions && transactions.length > 0) {
        transactions.forEach(t => {
          const procedimento = t.atendimento_procedimentos?.[0]?.procedimentos?.nome || '';
          const cliente = t.clientes?.nome || '';
          csv += `Receita,${new Date(t.data).toLocaleDateString('pt-BR')},"${cliente}","${procedimento}",${t.valor_total || 0},"${t.forma_pagamento || ''}"\n`;
        });
      }

      // Custos
      if (contas && contas.length > 0) {
        contas.forEach(c => {
          csv += `Custo,${new Date(c.data).toLocaleDateString('pt-BR')},"${c.categoria || ''}","${c.descricao || ''}",${c.valor || 0},\n`;
        });
      }

      return Buffer.from(csv, 'utf-8');
    } catch (error) {
      console.error('[EXCEL] ❌ Erro ao gerar CSV:', error);
      throw error;
    }
  }
}

module.exports = new ExcelService();

