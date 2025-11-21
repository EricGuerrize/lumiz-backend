# 📋 Fluxo de Onboarding Corrigido

## 🎯 Baseado no Fluxo Antigo + Adaptações

### 1. Detecção de Usuário
- **Usuário Antigo:** Tem perfil OU onboarding completo → Mensagem de boas-vindas
- **Novo Usuário:** Não tem perfil E não tem onboarding completo → 3 mensagens iniciais

### 2. Onboarding (Ordem Original + Adaptações)

**FLUXO ANTIGO (base):**
1. Nome completo
2. Nome da clínica
3. CNPJ (opcional)
4. Número de funcionários
5. Volume mensal

**ADAPTAÇÕES (inserir no meio):**
- **Após nome da clínica:** Perfil (Proprietária, Gestora, Recepcionista, Outra)
- **Após perfil:** Formas de pagamento (PIX, Cartão, Dinheiro, Link, Outros)
- **Após volume:** Momento WOW (pedir primeira venda)
- **Após primeira venda:** Fluxo de custos (variável + fixo)
- **Após custos:** Resumo final (sem margem)

**ORDEM FINAL:**
1. Nome completo
2. Nome da clínica
3. **Perfil** (NOVO)
4. **Formas de pagamento** (NOVO)
5. CNPJ (opcional)
6. Número de funcionários
7. Volume de procedimentos (trocar "vendas" por "procedimentos")
8. **Momento WOW** (NOVO - pedir primeira venda)
9. **Fluxo de custos** (NOVO - variável + fixo)
10. **Resumo final** (NOVO - sem margem)
11. Link de cadastro

### 3. Mensagens Corrigidas

#### Formas de Pagamento:
❌ **ERRADO:**
```
Hoje você recebe como? (Pode marcar mais de uma)
• PIX
• Cartão
...
Digite as opções separadas por vírgula (ex: "PIX, Cartão").
```

✅ **CORRETO:**
```
Hoje você recebe como?

• PIX
• Cartão
• Dinheiro
• Link de pagamento
• Outros

Digite as opções separadas por vírgula (ex: "PIX, Cartão").
```

#### Volume:
❌ **ERRADO:** "quantas vendas você faz por mês?"
✅ **CORRETO:** "quantos procedimentos você faz por mês?"

#### Confirmação após formas de pagamento:
❌ **ERRADO:** "Ótimo! Já anotei suas formas de pagamento. 💜\n\nEm média, quantas vendas você faz por mês?"
✅ **CORRETO:** "Ótimo! Já anotei suas formas de pagamento. 💜\n\nEm média, quantos procedimentos você faz por mês?"

---

## 🔧 Mudanças Técnicas Necessárias

1. **startOnboarding:** Voltar para `step: 'nome_completo'` (não `nome_clinica`)
2. **processOnboarding:** Reorganizar cases na ordem correta
3. **Remover:** Cases duplicados/antigos que não são mais usados
4. **Corrigir:** Mensagens (remover "pode marcar", trocar "vendas" por "procedimentos")
5. **Garantir:** Transições corretas entre steps (sem pular ou misturar)

---

## 📝 Fluxo Completo Detalhado

```
1. Detecção (usuário antigo vs novo)
   ↓
2. Nome completo
   → "Qual o seu nome completo?"
   ↓
3. Nome da clínica
   → "Qual o nome da sua clínica?"
   ↓
4. Perfil (NOVO)
   → "Você é: 1. Proprietária(o) 2. Gestora(o) 3. Recepcionista 4. Outra função?"
   ↓
5. Formas de pagamento (NOVO)
   → "Hoje você recebe como?\n• PIX\n• Cartão\n• Dinheiro\n• Link de pagamento\n• Outros"
   ↓
6. CNPJ (opcional)
   → "Se tiver o CNPJ da clínica, já me passa? (ou Pular)"
   ↓
7. Número de funcionários
   → "Quantas pessoas trabalham com você? (1-5, 6-10, 11-20, 20+)"
   ↓
8. Volume de procedimentos
   → "Quantos procedimentos você faz por mês? (até 30, 30-60, 60-100, 100+)"
   ↓
9. Momento WOW (NOVO)
   → "Me envie uma venda da sua clínica..."
   ↓
10. Fluxo de custos (NOVO)
    → Pede custo variável → Classifica → Pede custo fixo
   ↓
11. Resumo final (NOVO)
    → Mostra receita, custos, saldo (SEM margem)
   ↓
12. Link de cadastro
```

---

**Status:** Aguardando aprovação para implementação

