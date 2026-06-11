const conversationRuntimeStateService = require('../../services/conversationRuntimeStateService');
const excelService = require('../../services/excelService');
const estoqueImportService = require('../../services/estoqueImportService');
const financialImportCopy = require('../../copy/financialImportWhatsappCopy');
const estoqueImportCopy = require('../../copy/estoqueImportWhatsappCopy');

class SpreadsheetImportHandler {
  constructor() {
    this.FINANCIAL_IMPORT_FLOW = 'financial_import';
    this.FINANCIAL_IMPORT_TTL_MS = 30 * 60 * 1000;
    this.SPREADSHEET_KIND_CHOICE_FLOW = 'spreadsheet_kind_choice';
    this.SPREADSHEET_KIND_CHOICE_TTL_MS = 15 * 60 * 1000;
    this.INVENTORY_IMPORT_FLOW = 'inventory_import';
    this.INVENTORY_IMPORT_TTL_MS = 30 * 60 * 1000;
  }

  async startFinancialImportFromSpreadsheet(phone, context = {}) {
    if (!context.importToken) return;
    await conversationRuntimeStateService.upsert(
      phone,
      this.FINANCIAL_IMPORT_FLOW,
      {
        stage: 'confirm',
        importToken: context.importToken,
        preview: context.preview || [],
        summary: context.summary || {},
        inconsistencias: context.inconsistencias || [],
        filename: context.filename || null,
      },
      this.FINANCIAL_IMPORT_TTL_MS
    );
  }

  async hasPendingFinancialImport(phone) {
    const pending = await conversationRuntimeStateService.get(phone, this.FINANCIAL_IMPORT_FLOW);
    return Boolean(pending?.payload?.stage);
  }

  async handlePendingFinancialImport(phone, message, user) {
    const pending = await conversationRuntimeStateService.get(phone, this.FINANCIAL_IMPORT_FLOW);
    if (!pending?.payload?.stage) return null;

    const normalized = String(message || '').trim().toLowerCase();
    const isConfirm = ['1', 'sim', 's', 'confirmar'].includes(normalized);
    const isCancel = ['2', 'não', 'nao', 'n', 'cancelar'].includes(normalized);

    if (isCancel) {
      await conversationRuntimeStateService.clear(phone, this.FINANCIAL_IMPORT_FLOW);
      return financialImportCopy.importCancelled();
    }

    if (!isConfirm) {
      return financialImportCopy.previewImport({
        preview: pending.payload.preview,
        summary: pending.payload.summary,
        inconsistencias: pending.payload.inconsistencias,
        filename: pending.payload.filename,
      });
    }

    try {
      const result = await excelService.confirmImport(user.id, pending.payload.importToken);
      await conversationRuntimeStateService.clear(phone, this.FINANCIAL_IMPORT_FLOW);
      return financialImportCopy.importConfirmed(result.summary);
    } catch (error) {
      await conversationRuntimeStateService.clear(phone, this.FINANCIAL_IMPORT_FLOW);
      return financialImportCopy.importFailed(error.message);
    }
  }

  async startSpreadsheetKindChoice(phone, context = {}) {
    if (!context?.estoque?.importToken || !context?.financeiro?.importToken) return;
    await conversationRuntimeStateService.upsert(
      phone,
      this.SPREADSHEET_KIND_CHOICE_FLOW,
      {
        stage: 'choice',
        filename: context.filename || null,
        estoque: context.estoque,
        financeiro: context.financeiro,
      },
      this.SPREADSHEET_KIND_CHOICE_TTL_MS
    );
  }

  async hasPendingSpreadsheetKindChoice(phone) {
    const pending = await conversationRuntimeStateService.get(phone, this.SPREADSHEET_KIND_CHOICE_FLOW);
    return Boolean(pending?.payload?.stage);
  }

  async handlePendingSpreadsheetKindChoice(phone, message) {
    const pending = await conversationRuntimeStateService.get(phone, this.SPREADSHEET_KIND_CHOICE_FLOW);
    if (!pending?.payload?.stage) return null;

    const normalized = String(message || '').trim().toLowerCase();
    const chooseInventory = ['1', 'estoque', 'importar estoque', 'planilha estoque'].includes(normalized);
    const chooseFinancial = ['2', 'financeiro', 'importar financeiro', 'planilha financeiro'].includes(normalized);
    const isCancel = ['cancelar', 'não', 'nao', 'n'].includes(normalized);

    if (isCancel) {
      await conversationRuntimeStateService.clear(phone, this.SPREADSHEET_KIND_CHOICE_FLOW);
      return financialImportCopy.kindChoiceCancelled();
    }

    if (!chooseInventory && !chooseFinancial) {
      return financialImportCopy.askKindChoice({
        filename: pending.payload.filename,
        estoqueSummary: pending.payload.estoque?.summary,
        financeiroSummary: pending.payload.financeiro?.summary,
      });
    }

    await conversationRuntimeStateService.clear(phone, this.SPREADSHEET_KIND_CHOICE_FLOW);

    if (chooseInventory) {
      await conversationRuntimeStateService.upsert(
        phone,
        this.INVENTORY_IMPORT_FLOW,
        {
          stage: 'confirm',
          importToken: pending.payload.estoque.importToken,
          preview: pending.payload.estoque.preview || [],
          summary: pending.payload.estoque.summary || {},
          inconsistencias: pending.payload.estoque.inconsistencias || [],
          filename: pending.payload.filename || null,
        },
        this.INVENTORY_IMPORT_TTL_MS
      );
      return estoqueImportCopy.previewImport({
        preview: pending.payload.estoque.preview,
        summary: pending.payload.estoque.summary,
        inconsistencias: pending.payload.estoque.inconsistencias,
        filename: pending.payload.filename,
      });
    }

    await this.startFinancialImportFromSpreadsheet(phone, {
      importToken: pending.payload.financeiro.importToken,
      preview: pending.payload.financeiro.preview,
      summary: pending.payload.financeiro.summary,
      inconsistencias: pending.payload.financeiro.inconsistencias,
      filename: pending.payload.filename,
    });
    return financialImportCopy.previewImport({
      preview: pending.payload.financeiro.preview,
      summary: pending.payload.financeiro.summary,
      inconsistencias: pending.payload.financeiro.inconsistencias,
      filename: pending.payload.filename,
    });
  }
}

module.exports = SpreadsheetImportHandler;
