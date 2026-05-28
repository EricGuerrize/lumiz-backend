# Onboarding V2 - Fluxo de Mensagens no WhatsApp

Este documento mostra o fluxo atual do onboarding V2 como o usuário vê no WhatsApp.

## 1. Boas-Vindas

```text
Oi! Sou a Lumiz, sua CFO no WhatsApp 💜

Você é a *dona da clínica* ou alguém da equipe?

_(Ao continuar, você concorda com nossa política de privacidade: https://lumiz.app/privacidade)_
```

Se o bot não entender se a pessoa é dona/gestora ou equipe:

```text
Não entendi muito bem 😅 Você é a *dona / sócia* da clínica ou faz parte do time (secretária, recepcionista, adm)?
```

## 2. Primeira Venda

```text
Me conta uma venda que você fez essa semana 💰

Pode ser simples assim: _"fiz botox, 1.2k no pix"_
```

### Quando Entende Venda Com Pagamento

Exemplo: usuário envia `Botox 900 pix`.

```text
Entendi: *Botox* R$ 900,00 no pix. Tá certo? Me diz se quiser corrigir algo.
```

### Quando Falta Forma de Pagamento

Exemplo: usuário envia `Botox 900`.

```text
Foi no PIX, dinheiro, débito ou crédito? Se foi parcelado, pode mandar tipo _"3x no cartão"_.
```

Depois de responder `3x no cartão`, o bot confirma:

```text
Entendi: *Botox* R$ 900,00 no parcelado. Tá certo? Me diz se quiser corrigir algo.
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
Entendi: *Botox* R$ 1.200,00 no credito. Tá certo? Me diz se quiser corrigir algo.
```

## 3. Primeiro Custo

```text
E um custo recente? 💸

Pode mandar a *nota fiscal* (foto/PDF) ou digitar:
_"Insumos Biogelis R$ 800"_
```

### Quando Entende Custo Digitado

Exemplo: usuário envia `Insumos Biogelis 800`.

```text
Entendi: *Insumos Biogelis* R$ 800,00. Confirma? Me diz se precisar corrigir.
```

### Quando Entende Nota Fiscal, Foto ou PDF

Exemplo: usuário envia uma foto de nota fiscal.

```text
Entendi: *Nota fiscal de insumos* R$ 450,00. Confirma? Me diz se precisar corrigir.
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
Entendi: *toxina* R$ 350,00. Confirma? Me diz se precisar corrigir.
```

## 4. Insight

Exemplo com venda de Botox por R$ 900 e custo de R$ 200:

```text
Show 🎯 Já tenho algo útil pra você:
Nesse Botox, seu insumo ficou em *22% da receita* — fora da faixa recomendada (25-40% pra esse tipo).

No PIX você recebe *R$ 900,00* líquido.
Se fosse parcelado no crédito, entraria *~R$ 864,00* (estimativa de mercado — me diz sua taxa real pra refinar).

Quer ver isso pra todos os seus procedimentos?
```

## 5. Encerramento

### Para Dona ou Gestora

```text
Pronto, já tenho o primeiro retrato financeiro da sua clínica no WhatsApp ✅

Por enquanto vamos usar essa conversa pra deixar seus lançamentos bem redondos. Pode continuar me mandando receitas, custos e dúvidas por aqui.
```

Se `ONBOARDING_DASHBOARD_TEASER_VIDEO_URL` estiver configurado, o bot também envia um vídeo teaser do dashboard com a legenda:

```text
Um spoiler do que está vindo: o dashboard da Lumiz vai reunir seus lançamentos e insights em uma visão mais visual.

Por enquanto, seguimos deixando tudo redondo por aqui no WhatsApp.
```

### Para Equipe

```text
Legal! Que tal a gente mostrar isso pra dona da clínica? 🤝

Posso montar um resuminho financeiro pra você encaminhar pra ela. Quer?
```

Se `ONBOARDING_DASHBOARD_TEASER_VIDEO_URL` estiver configurado, o vídeo teaser também é enviado ao final.

## Resumo da Máquina de Estados

```text
ACT1_ROLE
  -> ACT2_SALE
  -> ACT2_PAYMENT, se faltar forma de pagamento
  -> ACT2_SALE_CONFIRM
  -> ACT3_COST
  -> ACT3_COST_CONFIRM
  -> ACT4_AHA
  -> encerramento
```

## Observações Atuais

- O fluxo V2 não envia link do dashboard no final.
- O fluxo V2 pode enviar um vídeo teaser do dashboard futuro se `ONBOARDING_DASHBOARD_TEASER_VIDEO_URL` estiver configurado.
- O usuário pode corrigir venda ou custo respondendo `não, foi...`.
- O custo aceita texto, foto ou PDF.
- A venda exige forma de pagamento antes de ser salva.
- Após o onboarding, o usuário pode continuar usando o bot pelo WhatsApp.
