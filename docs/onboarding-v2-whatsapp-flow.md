# Onboarding V2 - Fluxo de Mensagens no WhatsApp

Este documento mostra o fluxo atual do onboarding V2 como o usuário vê no WhatsApp.

## 1. Boas-Vindas

```text
Oi! Sou a Lumiz, sua CFO no WhatsApp 💜

Vou montar um mini raio-x financeiro usando uma venda real da clínica: receita, custo, taxa de cartão e margem.

Sem planilha e sem cadastro longo. Posso começar?
```

Se o bot não entender o aceite:

```text
Me responde com *sim* para eu montar o primeiro raio-x financeiro da clínica aqui no WhatsApp.
```

## 2. Primeira Venda

```text
Perfeito. Primeiro, me manda uma *venda real* desta semana 💰

Pode escrever natural, do jeito que falaria no balcão:
_"botox R$ 2.500 no crédito em 2x"_
```

### Quando Entende Venda Com Pagamento

Exemplo: usuário envia `Botox 900 pix`.

```text
Receita-base do diagnóstico:
*Botox* — R$ 900,00 no pix.

Está certo? Se tiver algo diferente, pode corrigir em uma frase.
```

### Quando Falta Forma de Pagamento

Exemplo: usuário envia `Botox 900`.

```text
Qual foi a forma de pagamento dessa venda? PIX, dinheiro, débito ou crédito? Se foi parcelado, pode mandar tipo _"3x no cartão"_.
```

Depois de responder `3x no cartão`, o bot confirma:

```text
Receita-base do diagnóstico:
*Botox* — R$ 900,00 no parcelado.

Está certo? Se tiver algo diferente, pode corrigir em uma frase.
```

### Quando a Venda É No Cartão

Depois da confirmação, o bot pergunta a taxa da maquininha:

```text
Boa. Como foi no cartão, tem uma parte importante: *taxa da maquininha*.

Você sabe a taxa dessa venda? Pode responder tipo _"3,2%"_.
Se não souber, manda _"não sei"_ que eu uso uma estimativa conservadora.
```

### Quando Não Entende Valor

```text
Não consegui identificar o valor 🤔 Tenta assim: _"botox R$ 1.200 no pix"_
```

### Correção Sem Detalhes

Se o usuário responde apenas `não`:

```text
Ok! Me manda o valor e a forma de pagamento corrigidos:
```

### Correção Com Detalhes

Se o usuário responde `não, foi R$ 1200 no crédito`, o bot corrige e confirma de novo:

```text
Receita-base do diagnóstico:
*Botox* — R$ 1.200,00 no credito.

Está certo? Se tiver algo diferente, pode corrigir em uma frase.
```

## 3. Primeiro Custo

```text
Agora vamos cruzar essa venda com um custo real 💸

Pode mandar a *nota fiscal* em foto/PDF ou digitar o principal custo ligado ao procedimento:
_"toxina R$ 800"_ ou _"luvas R$ 500"_
```

### Quando Entende Custo Digitado

Exemplo: usuário envia `Insumos Biogelis 800`.

```text
Custo identificado:
*Insumos Biogelis* — R$ 800,00.

Confirma? Se não for isso, me manda a correção.
```

### Quando Entende Nota Fiscal, Foto ou PDF

Exemplo: usuário envia uma foto de nota fiscal.

```text
Custo identificado:
*Nota fiscal de insumos* — R$ 450,00.

Confirma? Se não for isso, me manda a correção.
```

### Quando Não Consegue Ler a Nota

```text
Não consegui ler o valor da nota com segurança 🤔 Pode mandar de novo com uma foto mais nítida ou digitar assim: _"Insumos R$ 800"_.
```

### Quando Não Entende Valor no Texto

```text
Não consegui identificar o valor 🤔 Tenta assim: _"Insumos R$ 800"_
```

### Correção Sem Detalhes

Se o usuário responde apenas `não`:

```text
Ok! Me manda o custo correto:
```

### Correção Com Detalhes

Se o usuário responde `não, foi R$ 350 toxina`, o bot corrige e confirma de novo:

```text
Custo identificado:
*toxina* — R$ 350,00.

Confirma? Se não for isso, me manda a correção.
```

## 4. Insight

Exemplo com venda de Botox por R$ 900 e custo de R$ 200:

```text
Aqui está o primeiro raio-x financeiro desse Botox 🎯
• Receita analisada: *R$ 900,00*
• Custo informado: *R$ 200,00*
• Peso do custo: *22% da receita* — fora da faixa recomendada (25-40% como referência inicial).
• Recebimento líquido: *R$ 900,00*.
• Margem estimada depois desse custo: *R$ 700,00* (78%).

Esse é o tipo de leitura que a Lumiz vai montar automaticamente para cada lançamento. Quer continuar por aqui no WhatsApp?
```

## 5. Encerramento

```text
Perfeito. A Lumiz já está pronta para operar como CFO da clínica no WhatsApp ✅

A partir de agora, pode me mandar:
• receitas e despesas em texto, áudio, foto ou PDF;
• notas fiscais e comprovantes;
• perguntas como _"quanto entrou este mês?"_ ou _"qual custo mais pesou?"_.

Seu teste fica ativo por 14 dias. Por enquanto vamos focar em deixar os lançamentos bem redondos aqui na conversa.
```

Se `ONBOARDING_DASHBOARD_TEASER_VIDEO_URL` estiver configurado, o bot também envia um vídeo teaser do dashboard com a legenda:

```text
Um spoiler do que está vindo: o dashboard da Lumiz vai reunir seus lançamentos e insights em uma visão mais visual.

Por enquanto, seguimos deixando tudo redondo por aqui no WhatsApp.
```

## Resumo da Máquina de Estados

```text
ACT1_START
  -> ACT2_SALE
  -> ACT2_PAYMENT, se faltar forma de pagamento
  -> ACT2_SALE_CONFIRM
  -> ACT2_MDR_RATE, se venda for no cartão/débito/parcelado
  -> ACT3_COST
  -> ACT3_COST_CONFIRM
  -> ACT4_AHA
  -> encerramento
```

## Observações Atuais

- O fluxo V2 não envia link do dashboard no final.
- O fluxo V2 pode enviar um vídeo teaser do dashboard futuro se `ONBOARDING_DASHBOARD_TEASER_VIDEO_URL` estiver configurado.
- O fluxo V2 não pergunta cargo. Ele trata quem está no WhatsApp como operador autorizado da clínica.
- O usuário pode corrigir venda ou custo respondendo `não, foi...`.
- O custo aceita texto, foto ou PDF.
- Vendas em cartão perguntam taxa da maquininha; se o usuário não souber, o bot usa estimativa conservadora.
- A venda exige forma de pagamento antes de ser salva.
- Após o onboarding, o usuário pode continuar usando o bot pelo WhatsApp.
