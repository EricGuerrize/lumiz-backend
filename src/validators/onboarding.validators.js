const { z } = require('zod');

// Phone validation schema
const phoneSchema = z.string()
  .min(10, 'Telefone deve ter pelo menos 10 dígitos')
  .max(20, 'Telefone deve ter no máximo 20 dígitos')
  .regex(/^\+?[0-9]+$/, 'Telefone deve conter apenas números');

// Onboarding state schemas
const updateStateSchema = z.object({
  body: z.object({
    stage: z.string().optional(),
    phase: z.number().int().min(1).max(3).optional(),
    data: z.record(z.any()).optional(),
    steps: z.array(z.any()).optional(),
    abVariant: z.string().optional(),
    completed: z.boolean().optional(),
    meta: z.record(z.any()).optional(),
    progress_percent: z.number().int().min(0).max(100).optional(),
    userId: z.string().uuid().optional()
  }).optional()
});

const recordStepSchema = z.object({
  body: z.object({
    stepId: z.string().min(1, 'stepId é obrigatório'),
    status: z.enum(['pending', 'completed', 'skipped']).optional(),
    metadata: z.record(z.any()).optional()
  })
});

const saveManualMdrSchema = z.object({
  body: z.object({
    bandeiras: z.array(z.string()).min(1, 'Pelo menos uma bandeira é obrigatória'),
    tiposVenda: z.record(z.any()).optional(),
    parcelas: z.record(z.any()).optional(),
    provider: z.string().optional(),
    phone: z.string().optional(),
    userId: z.string().uuid().optional()
  })
});

const requestOcrSchema = z.object({
  body: z.object({
    imageUrl: z.string().url('imageUrl deve ser uma URL válida'),
    provider: z.string().optional(),
    phone: z.string().optional(),
    userId: z.string().uuid().optional()
  })
});

const confirmMdrConfigSchema = z.object({
  params: z.object({
    configId: z.string().uuid('configId deve ser um UUID válido')
  }),
  body: z.object({
    confirmed: z.boolean().optional()
  }).optional()
});

const recordNpsSchema = z.object({
  body: z.object({
    score: z.number().int().min(0).max(10, 'NPS score deve estar entre 0 e 10'),
    feedback: z.string().max(1000, 'Feedback muito longo').optional()
  })
});

module.exports = {
  updateStateSchema,
  recordStepSchema,
  saveManualMdrSchema,
  requestOcrSchema,
  confirmMdrConfigSchema,
  recordNpsSchema
};
