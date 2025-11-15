# 💬 Exemplos de Conversas - Lumiz

Exemplos reais de como as conversas ficaram após as melhorias implementadas.

---

## 🎯 Fluxo 1: Saudação Inicial

**Usuário:** Oi

**Lumiz:**
```
Oi! Sou a Lumiz 💜
Sua assistente financeira para clínicas de estética.

Em poucos minutos, você vai conseguir:
✨ Registrar vendas e custos pelo WhatsApp
📊 Ver resumos financeiros sempre atualizados
💰 Saber quanto lucrou no mês – sem planilhas

Você pode:
• Registrar venda: "Paciente Ana, preenchimento labial, R$ 1.500 no PIX"
• Registrar custo: "Paguei R$ 3.200 de insumos Allergan"
• Ver resumo: "Me mostra o resumo do mês"
• Ver histórico: "Mostra minhas últimas vendas"

Digite "ajuda" para ver mais exemplos!
```

---

## 💰 Fluxo 2: Registrar Venda (COM CONFIRMAÇÃO)

**Usuário:** Paciente Ana, preenchimento labial, R$ 1.500 no PIX

**Lumiz:**
```
Confere se está certo 👇

💰 *Tipo:* Receita (venda)
💵 *Valor:* R$ 1500.00
📂 *Categoria:* Preenchimento labial
📝 *Descrição:* Paciente Ana - PIX
📅 *Data:* 14/11/2025

Está tudo certo?
Responda "sim" para confirmar ou "não" para cancelar.
```

**Usuário:** sim

**Lumiz:**
```
💰 *Receita registrada com sucesso!*

Tudo anotadinho! ✅
```

---

## 💸 Fluxo 3: Registrar Custo

**Usuário:** Paguei o boleto de R$ 3.200 dos insumos Allergan

**Lumiz:**
```
Confere se está certo 👇

💸 *Tipo:* Custo (despesa)
💵 *Valor:* R$ 3200.00
📂 *Categoria:* Insumos
📝 *Descrição:* Allergan - Boleto
📅 *Data:* 14/11/2025

Está tudo certo?
Responda "sim" para confirmar ou "não" para cancelar.
```

**Usuário:** confirmar

**Lumiz:**
```
💸 *Custo registrado com sucesso!*

Tudo anotadinho! ✅
```

---

## ❌ Fluxo 4: Cancelar Registro

**Usuário:** Registra venda de botox, R$ 2.800

**Lumiz:**
```
Confere se está certo 👇

💰 *Tipo:* Receita (venda)
💵 *Valor:* R$ 2800.00
📂 *Categoria:* Botox facial
📅 *Data:* 14/11/2025

Está tudo certo?
Responda "sim" para confirmar ou "não" para cancelar.
```

**Usuário:** não

**Lumiz:**
```
Registro cancelado ❌

Se quiser registrar, é só me enviar novamente com os dados corretos!
```

---

## 📊 Fluxo 5: Ver Resumo Financeiro

**Usuário:** Qual meu lucro?

**Lumiz:**
```
📊 *Resumo Financeiro*

• Receitas: R$ 45.200,00
• Custos: R$ 18.300,00
• Lucro: R$ 26.900,00 (59.5%)

Quer ver o relatório detalhado? Digite "relatório do mês"
```

---

## 📜 Fluxo 6: Ver Histórico

**Usuário:** Mostra minhas últimas vendas

**Lumiz:**
```
📜 *Últimas movimentações*

💰 +R$ 1500.00
   Preenchimento labial • Paciente Ana - PIX
   14/11

💸 -R$ 3200.00
   Insumos • Allergan - Boleto
   14/11

💰 +R$ 2800.00
   Botox facial • Cartão 4x
   13/11

💰 +R$ 1200.00
   Bioestimuladores
   13/11

💸 -R$ 800.00
   Marketing / Publicidade
   12/11
```

---

## 📊 Fluxo 7: Relatório Mensal

**Usuário:** Resumo do mês

**Lumiz:**
```
📊 *Relatório de Novembro/2025*

✨ *Resumo Geral*
• Receitas: R$ 85.400,00
• Custos: R$ 34.100,00
• Lucro: R$ 51.300,00 (60.1%)
• Total de movimentações: 47

💼 *Por categoria:*
• Preenchimento labial: R$ 28.500,00
• Botox / Toxina Botulínica: R$ 24.800,00
• Harmonização Facial: R$ 18.200,00
• Bioestimuladores: R$ 9.600,00
• Procedimentos Corporais: R$ 4.300,00
```

---

## ❓ Fluxo 8: Ajuda

**Usuário:** ajuda

**Lumiz:**
```
*Como usar a Lumiz* 📋

*Registrar venda (receita):*
"Paciente Júlia, botox facial, R$ 2.800, cartão 4x"
"Registra: preenchimento labial, R$ 1.500, PIX"

*Registrar custo (despesa):*
"Paguei o boleto de R$ 3.200 dos insumos"
"Custo de R$ 800 com marketing"

*Consultas:*
"Qual meu lucro do mês?"
"Mostra minhas últimas vendas"
"Resumo financeiro de novembro"

Precisa de ajuda? Só chamar! 😊
```

---

## 🔧 Diferenças Implementadas

### ✅ ANTES (genérico)
```
Receita registrada!

Valor: R$ 50.00
Categoria: mercado
Data: 14/11/2025
```

### ✨ DEPOIS (personalizado para clínicas)
```
Confere se está certo 👇

💰 *Tipo:* Receita (venda)
💵 *Valor:* R$ 1500.00
📂 *Categoria:* Preenchimento labial
📝 *Descrição:* Paciente Ana - PIX
📅 *Data:* 14/11/2025

Está tudo certo?
Responda "sim" para confirmar ou "não" para cancelar.
```

---

**Documento atualizado em:** 14/11/2025
