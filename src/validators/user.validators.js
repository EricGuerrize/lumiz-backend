const { z } = require('zod');

const linkEmailSchema = z.object({
  body: z.object({
    email: z.string().email('Email inválido'),
    token: z.string().uuid('Token deve ser um UUID válido'),
    phone: z.string().optional()
  })
});

module.exports = {
  linkEmailSchema
};
