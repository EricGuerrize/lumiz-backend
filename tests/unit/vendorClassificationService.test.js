process.env.NODE_ENV = 'test';

const mockUpsert = jest.fn().mockResolvedValue({ error: null });

jest.mock('../../src/db/supabase', () => ({
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    ilike: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: [{ category: 'insumos', is_global: true }], error: null }),
    upsert: mockUpsert
  }))
}));

const vendorClassificationService = require('../../src/services/vendorClassificationService');

describe('vendorClassificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normaliza categoria de exibição para storage', () => {
    expect(vendorClassificationService.normalizeCategoryForStorage('Insumos / materiais')).toBe('insumos');
    expect(vendorClassificationService.normalizeCategoryForStorage('Aluguel')).toBe('aluguel');
    expect(vendorClassificationService.normalizeCategoryForStorage('Taxas')).toBe('cartao');
  });

  it('normaliza storage para exibição', () => {
    expect(vendorClassificationService.normalizeCategoryForDisplay('insumos')).toBe('Insumos');
    expect(vendorClassificationService.normalizeCategoryForDisplay('pessoal')).toBe('Salários');
  });

  it('classifica fornecedor conhecido', async () => {
    const category = await vendorClassificationService.classifyVendor('Biogelis', 'user-1');
    expect(category).toBe('insumos');
  });

  it('persiste aprendizado com categoria de exibição normalizada', async () => {
    await vendorClassificationService.learnVendorClassification('Distribuidora X', 'Insumos', 'user-1');

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor_name: 'Distribuidora X',
        category: 'insumos',
        user_id: 'user-1',
        is_global: false
      }),
      { onConflict: 'vendor_name_normalized,user_id' }
    );
  });

  it('ignora categoria inválida no aprendizado', async () => {
    await vendorClassificationService.learnVendorClassification('Fornecedor Y', 'CategoriaInventada', 'user-1');
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
