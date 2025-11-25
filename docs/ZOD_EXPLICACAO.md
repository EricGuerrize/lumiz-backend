# O que é Zod?

**Zod** é uma biblioteca de validação de schemas TypeScript-first (mas funciona em JavaScript também).

## Para que serve?

Valida dados de entrada para garantir que estão no formato correto antes de processar.

## Exemplo Prático

```javascript
const { z } = require('zod');

// Define um schema (formato esperado)
const userSchema = z.object({
  phone: z.string().min(10).max(20),
  email: z.string().email(),
  age: z.number().min(18).max(100)
});

// Valida dados
try {
  const validData = userSchema.parse({
    phone: "5511999999999",
    email: "user@example.com",
    age: 25
  });
  // Se passar, dados são válidos!
} catch (error) {
  // Se falhar, mostra erro claro
  console.error(error.errors);
}
```

## Vantagens

✅ **Segurança**: Previne dados inválidos  
✅ **Clareza**: Erros descritivos  
✅ **TypeScript**: Gera tipos automaticamente  
✅ **Simples**: Fácil de usar  

## No Projeto Lumiz

Zod está no `package.json` mas **ainda não está sendo usado**. Poderia validar:
- Telefones no webhook
- Dados de transações
- Parâmetros de API
- Dados de onboarding

## Quando Usar

- Validar inputs de API
- Validar dados antes de salvar no banco
- Garantir tipos corretos
- Prevenir erros de runtime

---

**Resumo**: Zod = "Garantia de qualidade" para seus dados! 🛡️

