const { z } = require('zod');

const monthlyReportSchema = z.object({
  query: z.object({
    year: z.string().regex(/^\d{4}$/, 'Ano deve ter 4 dígitos').optional(),
    month: z.string().regex(/^(0?[1-9]|1[0-2])$/, 'Mês deve estar entre 1 e 12').optional()
  }).optional()
});

const searchTransactionsSchema = z.object({
  query: z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD').optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD').optional(),
    tipo: z.enum(['entrada', 'saida']).optional(),
    categoria: z.string().optional(),
    minValue: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Valor mínimo inválido').optional(),
    maxValue: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Valor máximo inválido').optional(),
    limit: z.string().regex(/^\d+$/, 'Limit deve ser um número').optional(),
    offset: z.string().regex(/^\d+$/, 'Offset deve ser um número').optional()
  }).optional()
});

const updateTransactionSchema = z.object({
  params: z.object({
    id: z.string().uuid('ID deve ser um UUID válido')
  }),
  body: z.object({
    amount: z.number().positive().optional(),
    description: z.string().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD').optional(),
    category_id: z.string().uuid().optional()
  }).optional()
});

const deleteTransactionSchema = z.object({
  params: z.object({
    id: z.string().uuid('ID deve ser um UUID válido')
  })
});

module.exports = {
  monthlyReportSchema,
  searchTransactionsSchema,
  updateTransactionSchema,
  deleteTransactionSchema
};
