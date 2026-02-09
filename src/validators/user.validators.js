const { z } = require('zod');

const linkEmailSchema = z.object({
  body: z.object({
    email: z.string().email('Email inválido'),
    token: z.string().uuid('Token deve ser um UUID válido'),
    phone: z.string().optional(),
    password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres')
  })
});

module.exports = {
  linkEmailSchema
};
