# 📱 Fluxo Conversacional Completo - Lumiz
## Assistente Financeira para Clínicas de Estética

---

## 🎯 Visão Geral

A **Lumiz** é uma assistente financeira conversacional que funciona 100% dentro do WhatsApp, inspirada no fluxo do **oiBill**, mas adaptada para o contexto de clínicas de estética e procedimentos estéticos.

**Princípios:**
- Uma pergunta por vez
- Sempre confirmar antes de salvar
- Minimizar digitação (usar botões)
- Automação inteligente (IA extrai dados)
- Onboarding gamificado

---

## 📊 Estrutura dos Fluxos

### F0 - Primeira Interação (Saudação)
### F1 - "Conhecer a Lumiz"
### F2 - Cadastro da Clínica
### F3 - Onboarding Gamificado
### F4 - Operação Diária (Registros)
### F5 - Relatórios e Consultas
### F6 - Tratamento de Erros

---

# F0 - PRIMEIRA INTERAÇÃO

## Gatilho
Usuário manda "Oi", "Olá", "Começar" ou clica no botão do site/Instagram.

## Mensagem da Lumiz

```
Oi! Sou a Lumiz 💜
Sua assistente financeira para clínicas de estética.

Em poucos minutos, você vai conseguir:
✨ Registrar vendas e custos pelo WhatsApp
📊 Ver resumos financeiros sempre atualizados
💰 Saber quanto lucrou no mês – sem planilhas

O que você quer fazer agora?
```

**Botões interativos:**
- ▸ Conhecer a Lumiz
- ▸ Começar meu cadastro

---

# F1 - CONHECER A LUMIZ

## Objetivo
Educar o usuário sobre o produto sem pedir dados sensíveis.

## Fluxo

### Mensagem 1 - Explicação rápida

```
Perfeito! Deixa eu te mostrar como funciona 👇

1️⃣ Você manda suas vendas e custos por aqui
   (pode ser texto, foto de nota, ou até áudio)

2️⃣ A Lumiz organiza tudo automaticamente
   (receitas, custos, lucro – tudo separadinho)

3️⃣ Você vê o financeiro da sua clínica claro e atualizado
   (sem abrir planilha, sem complicação)
```

### Mensagem 2 - Prova social + CTA

```
Clínicas como a sua já economizam 10h por mês só usando a Lumiz 🚀

Quer testar agora com um exemplo rápido?
```

**Botões:**
- ▸ Quero testar
- ▸ Só ver depois

**Se clicar "Quero testar"** → vai pro **F3 (Onboarding Gamificado)**
**Se clicar "Só ver depois":**

```
Sem problema! 😊
Quando quiser começar, é só mandar:
"Quero começar com a Lumiz"
```

---

# F2 - CADASTRO DA CLÍNICA

## Inspiração
Sequência do oiBill: tipo de cadastro → dados básicos → dados adicionais → confirmação.

## Princípios
- Uma pergunta por vez
- Barra de progresso visual
- Opção de "pular" campos opcionais
- Escape para humano

---

### Passo 1 - Tipo de clínica

```
Pra te ajudar direitinho, me conta:

Qual é o foco principal da sua clínica?
```

**Botões:**
- ▸ Estética facial
- ▸ Estética corporal
- ▸ Harmonização (HOF)
- ▸ Outros procedimentos

*Salvar no banco para segmentação futura.*

---

### Passo 2 - Nome da clínica

```
Ótimo! Agora me conta:

✏️ Qual o nome da sua clínica?
(Pode ser o nome fantasia)
```

Usuário responde: **"Clínica Bella Estética"**

---

### Passo 3 - Localização

```
Obrigada! E em qual cidade você atende?

📍 Ex: Cuiabá - MT
```

Usuário responde: **"Cuiabá - MT"**

---

### Passo 4 - Responsável financeiro

```
Perfeito! Agora preciso saber:

👤 Quem é o(a) responsável pelas finanças da clínica?

Me manda:
• Nome completo
• CPF ou CNPJ
```

Usuário responde:
**"Maria Silva
CPF: 123.456.789-00"**

---

### Passo 5 - Opção de completar ou pular

```
Quer preencher mais alguns detalhes agora ou prefere
ir direto pra parte de testar a Lumiz?
```

**Botões:**
- ▸ Completar cadastro
- ▸ Testar agora

**Se escolher "Completar":** pergunta endereço, número de funcionários, etc.
**Se escolher "Testar agora":** vai pro **F3 (Onboarding Gamificado)**.

---

### Passo 6 - Escape para humano

Em qualquer etapa, se o usuário mandar:
- "não sei"
- "tá complicado"
- "quero falar com alguém"

```
Sem problema! Vou chamar alguém do time Lumiz
pra te ajudar aqui mesmo no WhatsApp 😊

Em alguns minutos você recebe uma mensagem.
```

---

# F3 - ONBOARDING GAMIFICADO

## Objetivo
Mostrar o **resultado final** que a Lumiz entrega, usando uma simulação prática.

## Inspiração
"Cobrança teste" da oiBill.

---

### Passo 1 - Simulação de venda

```
Vamos fazer um teste rápido pra você ver como funciona? 🚀

Me manda uma venda fictícia assim:

"Paciente Ana fez preenchimento labial, pagou R$ 1.500 no PIX"
```

Usuário responde:
**"Paciente Ana fez preenchimento labial, pagou R$ 1.500 no PIX"**

---

### Passo 2 - Confirmação inteligente

```
Entendi assim 👇

👤 Paciente: Ana
💉 Procedimento: Preenchimento labial
💰 Valor: R$ 1.500,00
💳 Pagamento: PIX

Está certo?
```

**Botões:**
- ▸ Sim, pode registrar
- ▸ Corrigir

---

### Passo 3 - Mostrar "mini dashboard"

```
Pronto! Essa venda já entrou no seu financeiro ✅

Se esse fosse seu mês de novembro, você veria algo assim:

📊 Resumo do mês
• Receitas: R$ 45.200
• Custos: R$ 18.300
• Lucro: R$ 26.900 (59%)

Tudo calculado automaticamente com base nas vendas
e custos que você manda pra mim.
```

Pode inclusive **enviar uma imagem** de um dashboard estilizado da Lumiz.

---

### Passo 4 - Ensinar comando mágico

```
A qualquer momento, você pode pedir:

"Lumiz, me dá o resumo do mês de novembro"

E eu te mando tudo organizadinho, em segundos ✨

Quer criar sua primeira venda de verdade agora?
```

**Botões:**
- ▸ Sim, vamos lá
- ▸ Ver mais funcionalidades

---

# F4 - OPERAÇÃO DIÁRIA

## Exemplos de comandos que o agente entende

### Registrar venda

**Usuário:**
"Registra: paciente Juliana, botox facial, R$ 2.800, cartão 4x"

**Lumiz confirma:**
```
Entendido 👇

👤 Paciente: Juliana
💉 Procedimento: Botox facial
💰 Valor: R$ 2.800,00
💳 Pagamento: Cartão 4x
📅 Data: hoje (14/11)

Está certo?
```

**Botões:**
- ▸ Sim, salvar
- ▸ Corrigir

---

### Registrar custo

**Usuário:**
"Paguei o boleto de R$ 3.200 dos insumos da Allergan"

**Lumiz confirma:**
```
Certo 💸

• Tipo: Custo (saída)
• Valor: R$ 3.200,00
• Descrição: Insumos Allergan
• Pagamento: Boleto
• Data: hoje

Confirmar registro?
```

---

### Upload de documento (boleto, nota fiscal)

**Usuário:** *envia foto do boleto*

**Lumiz:**
```
Entendido! Vou ler esse documento...

✅ Li o boleto e encontrei:

• Fornecedor: Allergan Brasil
• Valor: R$ 3.200,00
• Vencimento: 20/11/2025
• Categoria: Insumos/Produtos

Quer que eu registre como custo?
```

**Botões:**
- ▸ Sim, registrar
- ▸ Editar

---

# F5 - RELATÓRIOS E CONSULTAS

## Comandos que o usuário pode dar

- "Me dá o resumo do mês"
- "Quanto faturei em novembro?"
- "Mostra meu lucro"
- "Relatório mensal"

---

## Resposta da Lumiz

```
Aqui está o resumo do seu mês 📊

✨ Clínica Bella Estética - Novembro/2025

• Receitas: R$ 85.400
• Custos: R$ 34.100
• Lucro: R$ 51.300 (60%)

Quer ver detalhes por:
```

**Botões:**
- ▸ Por categoria
- ▸ Por paciente
- ▸ Por forma de pagamento

---

# F6 - TRATAMENTO DE ERROS

## Usuário manda só número

**Usuário:** "2000"

**Lumiz:**
```
Esse valor é uma receita (venda) ou um custo (despesa)?
```

**Botões:**
- ▸ Receita
- ▸ Custo

---

## Usuário manda só procedimento

**Usuário:** "Botox"

**Lumiz:**
```
Você quer registrar isso como:
```

**Botões:**
- ▸ Venda (receita)
- ▸ Custo (compra)

---

## Usuário manda áudio

**Lumiz:**
```
Pode me confirmar por texto o valor e tipo
(receita ou custo)? Assim registro direitinho 😊
```

---

## Usuário manda contato

**Lumiz:**
```
Você quer cadastrar esse contato como:
```

**Botões:**
- ▸ Paciente
- ▸ Fornecedor

---

# 🎨 GUIA DE TOM DE VOZ

## Personalidade da Lumiz

- **Calma** e profissional
- **Direta** (sem enrolação)
- **Humana** (como uma pessoa do time)
- **Sem jargões** financeiros
- **Emojis pontuais** (não exagerar)

## Emojis permitidos

- 💜 (marca Lumiz)
- 💸 💰 (financeiro)
- ✅ (confirmação)
- 📊 (relatórios)
- 🚀 (progresso)

## Evitar

- "amiga", "querida"
- "rsrs", "kkk"
- 😊 excessivo
- Frases vagas tipo "tudo bem?"

---

# 🧩 IMPLEMENTAÇÃO TÉCNICA

## Botões Interativos no WhatsApp

Use **WhatsApp Business API** com:
- **Quick Reply Buttons** (até 3 botões)
- **List Messages** (para listas maiores)

## Formulário Conversado

Use **state machine**:
- Estado: `AGUARDANDO_NOME_CLINICA`
- Estado: `AGUARDANDO_CIDADE`
- Estado: `AGUARDANDO_VALOR`
- etc.

## Confirmação Visual

Sempre use formatação:
```
*Resumo do registro:*
• Campo 1
• Campo 2
```

## Memória de Contexto

Guardar:
- Nome da clínica
- Último tipo de operação (venda/custo)
- Data contextual ("ontem", "hoje")

---

# ✅ CHECKLIST DE IMPLEMENTAÇÃO

- [ ] System prompt configurado
- [ ] Memória de contexto ativa
- [ ] Botões interativos funcionando
- [ ] Leitura de documentos (OCR/Vision AI)
- [ ] Escape para humano
- [ ] Dashboard visual (imagem ou texto formatado)
- [ ] Testes de erro (número solto, áudio, etc.)

---

**Documento criado para a equipe Lumiz**
Data: 14/11/2025
