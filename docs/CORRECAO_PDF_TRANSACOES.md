# 🔧 Correção: Transações Detalhadas no PDF

## 🐛 Problema Identificado

No PDF do relatório mensal, apareciam transações assim:

```
--/--/---- CUSTO Sem categoria
--/--/---- CUSTO Sem categoria
```

**Problema:** Data e categoria não apareciam corretamente.

---

## 🔍 Causa Raiz

O `getMonthlyReport` retorna um array `transacoes` que combina dois tipos de objetos com estruturas diferentes:

### 1. **Atendimentos** (Receitas)
```javascript
{
  data: "2025-12-08",
  valor_total: 500.00,
  observacoes: "Botox cliente Maria",
  atendimento_procedimentos: [{
    procedimentos: { nome: "Botox" }
  }]
}
```

### 2. **Contas a Pagar** (Custos)
```javascript
{
  data: "2025-12-08",
  valor: 200.00,
  categoria: "Insumos",
  descricao: "Compra de insumos"
}
```

**O PDF estava tentando acessar campos que não existem:**
- ❌ `t.type` → Não existe (precisa detectar se é atendimento ou conta)
- ❌ `t.amount` → Não existe (é `valor_total` ou `valor`)
- ❌ `t.date` → Deveria ser `data`
- ❌ `t.categories?.name` → Não existe (precisa extrair de `atendimento_procedimentos` ou `categoria`)

---

## ✅ Correção Aplicada

### Antes (Código Incorreto):
```javascript
const tipo = t.type === 'entrada' ? 'RECEITA' : 'CUSTO';
const valor = parseFloat(t.amount || 0);
let dataStr = '--/--/----';
if (t.date) { ... }
const categoria = t.categories?.name || 'Sem categoria';
```

### Depois (Código Corrigido):
```javascript
// Detecta se é atendimento (entrada) ou conta_pagar (saída)
const isAtendimento = !!t.valor_total; // Atendimentos têm valor_total
const tipo = isAtendimento ? 'RECEITA' : 'CUSTO';
const valor = isAtendimento 
  ? parseFloat(t.valor_total || 0)
  : parseFloat(t.valor || 0);

// Usa campo 'data' correto
const dataTransacao = t.data || t.date;
if (dataTransacao) {
  const dateObj = new Date(dataTransacao);
  if (!isNaN(dateObj.getTime())) {
    dataStr = dateObj.toLocaleDateString('pt-BR');
  }
}

// Extrai categoria corretamente
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
```

---

## 📊 O que São Essas Transações?

As "TRANSAÇÕES DETALHADAS" no PDF são:

### 1. **Receitas (Atendimentos)**
- Cada venda/procedimento realizado
- Exemplo: "Botox R$ 500,00 - Cliente Maria"
- Categoria vem do procedimento cadastrado

### 2. **Custos (Contas a Pagar)**
- Cada despesa/gasto da clínica
- Exemplo: "Insumos R$ 200,00"
- Categoria vem do campo `categoria` ou `descricao`

---

## 🎯 Resultado Esperado Agora

Após a correção, o PDF deve mostrar:

```
TRANSAÇÕES DETALHADAS

08/12/2025 RECEITA Botox                    R$ 500,00
           Cliente Maria - PIX

08/12/2025 CUSTO   Insumos                  R$ 200,00
           Compra de insumos para procedimentos
```

**Com:**
- ✅ Data formatada corretamente (DD/MM/YYYY)
- ✅ Tipo correto (RECEITA ou CUSTO)
- ✅ Categoria extraída corretamente
- ✅ Valor formatado
- ✅ Descrição/observações quando disponível

---

## 🔧 Melhorias Adicionais

1. **Ordenação por Data**
   - Transações agora são ordenadas (mais recentes primeiro)

2. **Limite de Caracteres**
   - Categoria limitada a 30 caracteres
   - Descrição limitada a 60 caracteres

3. **Fallbacks Inteligentes**
   - Se não tem procedimento, usa observações
   - Se não tem categoria, usa descrição
   - Sempre mostra algo útil, nunca "Sem categoria" vazio

---

## 📝 Estrutura de Dados Correta

### Atendimento (Receita):
```javascript
{
  id: "uuid",
  data: "2025-12-08",
  valor_total: 500.00,
  observacoes: "Cliente Maria - PIX",
  atendimento_procedimentos: [{
    procedimentos: {
      nome: "Botox"
    }
  }]
}
```

### Conta a Pagar (Custo):
```javascript
{
  id: "uuid",
  data: "2025-12-08",
  valor: 200.00,
  categoria: "Insumos",
  descricao: "Compra de insumos para procedimentos"
}
```

---

## ✅ Status

**Problema:** Corrigido ✅  
**Teste:** Execute novamente a geração de PDF  
**Resultado Esperado:** Transações com data, categoria e valores corretos

---

**Última atualização:** 09/12/2025
