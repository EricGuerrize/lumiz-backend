# Botões Interativos WhatsApp - Lumiz

## Resumo da Implementação

Os botões interativos foram implementados usando a Evolution API para melhorar a experiência do usuário e reduzir erros de digitação.

## Onde os Botões Aparecem

### 1. **Saudação Inicial**
Quando o usuário manda "oi", "olá" ou qualquer saudação:

```
Oi! Sou a Lumiz 💜
Sua assistente financeira para clínicas de estética.

Em poucos minutos, você vai conseguir:
✨ Registrar vendas e custos pelo WhatsApp
📊 Ver resumos financeiros sempre atualizados
💰 Saber quanto lucrou no mês – sem planilhas

O que você quer fazer?

[💰 Ver meu saldo] [📋 Ver histórico] [❓ Ver ajuda]
```

### 2. **Menu de Ajuda**
Quando o usuário pede "ajuda":

```
Como usar a Lumiz 📋

*Registrar venda (receita):*
"Paciente Júlia, botox facial, R$ 2.800, cartão 4x"

*Registrar custo (despesa):*
"Paguei o boleto de R$ 3.200 dos insumos"

*Consultas:*
"Qual meu lucro do mês?"

O que você quer fazer agora?

[💰 Ver saldo] [📋 Histórico] [📊 Relatório mensal]
```

### 3. **Confirmação de Transação**
Quando o usuário registra uma movimentação:

```
Confere se está certo 👇

💰 Tipo: Receita (venda)
💵 Valor: R$ 1.500,00
📂 Categoria: Preenchimento labial
📝 Descrição: Paciente Ana - PIX
📅 Data: 15/11/2025

Está tudo certo?

[✅ Confirmar] [❌ Cancelar]
```

### 4. **Apenas Valor (sem contexto)**
Quando o usuário manda só um número (ex: "1500"):

```
Vi que você mandou R$ 1.500,00 💰

Isso é uma receita (venda) ou um custo (despesa)?

[💰 Receita] [💸 Custo]
```

## Implementação Técnica

### Arquivo: `evolutionService.js`

Dois novos métodos foram adicionados:

#### `sendButtons(phone, message, buttons)`
- Envia botões de resposta rápida (até 3 botões)
- Fallback automático para mensagem de texto se falhar
- Exemplo:
```javascript
await evolutionService.sendButtons(
  phone,
  'Está tudo certo?',
  ['✅ Confirmar', '❌ Cancelar']
);
```

#### `sendList(phone, message, buttonText, sections)`
- Envia listas interativas (para quando tiver mais de 3 opções)
- Útil para escolher categorias
- Exemplo:
```javascript
await evolutionService.sendList(
  phone,
  'Escolha a categoria',
  'Ver opções',
  [
    {
      title: 'Procedimentos',
      rows: [
        { title: 'Botox', description: 'Toxina botulínica' },
        { title: 'Preenchimento', description: 'Ácido hialurônico' }
      ]
    }
  ]
);
```

### Arquivo: `messageController.js`

**Mudanças principais:**

1. **Retorno `null` quando botões são enviados**
   - Evita enviar mensagem duplicada
   - O controller verifica `if (response !== null)` antes de enviar

2. **Reconhecimento de respostas de botões**
   - `handleConfirmation` aceita "✅ Confirmar" ou "confirmar"
   - Usa `.includes('confirmar')` para capturar variações

3. **Novos parâmetros `phone` nos handlers**
   - `handleOnlyValue(intent, phone)` - precisa enviar botões
   - `handleOnlyProcedure(intent, phone)` - para futuras melhorias

### Arquivo: `geminiService.js`

Novos exemplos de treinamento adicionados:

```javascript
RESPOSTAS DE BOTÕES INTERATIVOS:
"💰 Ver meu saldo" → {"intencao":"consultar_saldo","dados":{}}
"📋 Ver histórico" → {"intencao":"consultar_historico","dados":{}}
"📊 Relatório mensal" → {"intencao":"relatorio_mensal","dados":{}}
"❓ Ver ajuda" → {"intencao":"ajuda","dados":{}}
```

Isso garante que o Gemini reconheça as respostas dos botões como intents válidos.

## Benefícios

✅ **Reduz erros de digitação** - usuário clica em vez de digitar
✅ **Experiência mais moderna** - visual clean e profissional
✅ **Confirmação visual** - zero margem de erro antes de salvar
✅ **Fallback automático** - se botões não funcionarem, usa texto
✅ **Guia o usuário** - deixa claro quais são as opções disponíveis

## Próximos Passos (Futuro)

- [ ] Usar `sendList` para escolher categorias dinamicamente
- [ ] Adicionar botões de edição rápida (ex: "Alterar valor")
- [ ] Botões para filtrar relatórios por período
- [ ] Menu principal com todas as funcionalidades
- [ ] Botões de ações rápidas (registrar venda/custo comum)

## Testando os Botões

1. Envie "oi" para ver os botões de boas-vindas
2. Envie "1500" para ver os botões de tipo (Receita/Custo)
3. Registre uma transação para ver os botões de confirmação
4. Envie "ajuda" para ver os botões do menu de ajuda

**Observação:** Os botões só funcionam no WhatsApp Business API. No WhatsApp Web normal, as mensagens aparecem como texto normal com as opções entre colchetes.
