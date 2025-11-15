# 🔘 Implementação de Botões Interativos no WhatsApp
## Guia Técnico para Lumiz

---

## 📱 Tipos de Mensagens Interativas

O WhatsApp Business API oferece 3 tipos principais:

1. **Reply Buttons** (até 3 botões)
2. **List Messages** (até 10 itens)
3. **Call-to-Action Buttons** (ligação, site)

---

## 🟢 1. REPLY BUTTONS (Quick Replies)

### Quando usar
- Perguntas com 2-3 opções
- Confirmações sim/não
- Escolhas simples

### Exemplo - Saudação Inicial

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "5565999999999",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "body": {
      "text": "Oi! Sou a Lumiz 💜\nSua assistente financeira para clínicas de estética.\n\nEm poucos minutos, você vai conseguir:\n✨ Registrar vendas e custos pelo WhatsApp\n📊 Ver resumos financeiros sempre atualizados\n💰 Saber quanto lucrou no mês\n\nO que você quer fazer agora?"
    },
    "action": {
      "buttons": [
        {
          "type": "reply",
          "reply": {
            "id": "btn_conhecer",
            "title": "Conhecer a Lumiz"
          }
        },
        {
          "type": "reply",
          "reply": {
            "id": "btn_cadastro",
            "title": "Começar cadastro"
          }
        }
      ]
    }
  }
}
```

### Recebendo a resposta

Quando o usuário clicar, você recebe:

```json
{
  "type": "interactive",
  "interactive": {
    "type": "button_reply",
    "button_reply": {
      "id": "btn_conhecer",
      "title": "Conhecer a Lumiz"
    }
  }
}
```

**No n8n:** use `{{ $json.entry[0].changes[0].value.messages[0].interactive.button_reply.id }}`

---

### Exemplo - Confirmação de Registro

```json
{
  "messaging_product": "whatsapp",
  "to": "5565999999999",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "body": {
      "text": "Confere se está certo 👇\n\n💸 Tipo: Receita (venda)\n💰 Valor: R$ 1.500,00\n📅 Data: 14/11\n💬 Descrição: Preenchimento labial\n💳 Pagamento: PIX\n\nEstá tudo certo pra registrar?"
    },
    "action": {
      "buttons": [
        {
          "type": "reply",
          "reply": {
            "id": "btn_confirmar",
            "title": "✅ Sim, salvar"
          }
        },
        {
          "type": "reply",
          "reply": {
            "id": "btn_corrigir",
            "title": "✏️ Corrigir"
          }
        }
      ]
    }
  }
}
```

---

## 📋 2. LIST MESSAGES

### Quando usar
- Mais de 3 opções
- Categorias/menus
- Seleção de items

### Exemplo - Tipo de Clínica

```json
{
  "messaging_product": "whatsapp",
  "to": "5565999999999",
  "type": "interactive",
  "interactive": {
    "type": "list",
    "header": {
      "type": "text",
      "text": "Cadastro da Clínica"
    },
    "body": {
      "text": "Qual é o foco principal da sua clínica?"
    },
    "footer": {
      "text": "Escolha uma opção"
    },
    "action": {
      "button": "Ver opções",
      "sections": [
        {
          "title": "Tipo de clínica",
          "rows": [
            {
              "id": "tipo_facial",
              "title": "Estética facial",
              "description": "Harmonização, botox, preenchimento"
            },
            {
              "id": "tipo_corporal",
              "title": "Estética corporal",
              "description": "Lipo, criolipólise, etc"
            },
            {
              "id": "tipo_hof",
              "title": "Harmonização (HOF)",
              "description": "Procedimentos de harmonização orofacial"
            },
            {
              "id": "tipo_outros",
              "title": "Outros procedimentos"
            }
          ]
        }
      ]
    }
  }
}
```

### Recebendo a resposta

```json
{
  "type": "interactive",
  "interactive": {
    "type": "list_reply",
    "list_reply": {
      "id": "tipo_hof",
      "title": "Harmonização (HOF)",
      "description": "Procedimentos de harmonização orofacial"
    }
  }
}
```

---

### Exemplo - Ver Relatório Detalhado

```json
{
  "messaging_product": "whatsapp",
  "to": "5565999999999",
  "type": "interactive",
  "interactive": {
    "type": "list",
    "body": {
      "text": "Aqui está o resumo do seu mês 📊\n\n✨ Novembro/2025\n\n• Receitas: R$ 85.400\n• Custos: R$ 34.100\n• Lucro: R$ 51.300 (60%)\n\nQuer ver detalhes?"
    },
    "action": {
      "button": "Ver detalhes",
      "sections": [
        {
          "title": "Visualizar por",
          "rows": [
            {
              "id": "rel_categoria",
              "title": "Por categoria",
              "description": "Procedimentos, insumos, etc"
            },
            {
              "id": "rel_paciente",
              "title": "Por paciente",
              "description": "Top pacientes do mês"
            },
            {
              "id": "rel_pagamento",
              "title": "Por forma de pagamento",
              "description": "PIX, cartão, dinheiro"
            },
            {
              "id": "rel_exportar",
              "title": "Exportar planilha"
            }
          ]
        }
      ]
    }
  }
}
```

---

## 🌐 3. CALL-TO-ACTION BUTTONS

### Quando usar
- Link para site
- Botão de ligação
- Formulário externo (em casos específicos)

### Exemplo - Onboarding com vídeo

```json
{
  "messaging_product": "whatsapp",
  "to": "5565999999999",
  "type": "interactive",
  "interactive": {
    "type": "cta_url",
    "header": {
      "type": "video",
      "video": {
        "link": "https://lumiz.com.br/onboarding-video.mp4"
      }
    },
    "body": {
      "text": "Veja como funciona a Lumiz! 🚀\n\nEm 1 minuto você entende como organizar o financeiro da sua clínica sem esforço."
    },
    "footer": {
      "text": "Assistir agora"
    },
    "action": {
      "name": "cta_url",
      "parameters": {
        "display_text": "Assistir vídeo",
        "url": "https://lumiz.com.br/demo"
      }
    }
  }
}
```

---

## 🔧 IMPLEMENTAÇÃO NO N8N

### Node Evolution API - Enviar Botões

```javascript
// No campo "Message" do node Evolution API

const messageData = {
  number: "{{$json.from}}",
  options: {
    delay: 1200,
    presence: "composing"
  },
  buttonMessage: {
    text: "Confere se está certo 👇\n\n💸 Tipo: Receita\n💰 Valor: R$ 1.500,00\n💬 Descrição: Preenchimento labial\n💳 Pagamento: PIX\n\nEstá certo?",
    buttons: [
      { buttonText: "✅ Sim, salvar", buttonId: "btn_confirmar" },
      { buttonText: "✏️ Corrigir", buttonId: "btn_corrigir" }
    ],
    footerText: "Lumiz - Assistente Financeira"
  }
};

return messageData;
```

### Capturar resposta de botão

```javascript
// No node "Switch" ou "IF"

const buttonId = $json.message?.buttonsResponseMessage?.selectedButtonId;

if (buttonId === "btn_confirmar") {
  // Salvar no banco
  return { action: "save" };
} else if (buttonId === "btn_corrigir") {
  // Voltar para edição
  return { action: "edit" };
}
```

---

## 📱 IMPLEMENTAÇÃO EM OUTROS FRAMEWORKS

### Make.com (Integromat)

```json
{
  "messaging_product": "whatsapp",
  "to": "{{phone}}",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "body": {
      "text": "{{message_text}}"
    },
    "action": {
      "buttons": "{{buttons_array}}"
    }
  }
}
```

### TypeBot / Voiceflow

Use o bloco **"Quick Reply"** ou **"Buttons"** nativo da plataforma.

### Custom Node.js

```javascript
const axios = require('axios');

async function sendButtonMessage(to, text, buttons) {
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: text },
      action: {
        buttons: buttons.map((btn, idx) => ({
          type: 'reply',
          reply: {
            id: btn.id,
            title: btn.title
          }
        }))
      }
    }
  };

  await axios.post(
    `${EVOLUTION_API_URL}/message/sendInteractive/${INSTANCE_NAME}`,
    payload,
    {
      headers: {
        'apikey': EVOLUTION_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );
}

// Uso
await sendButtonMessage(
  '5565999999999',
  'Está tudo certo?',
  [
    { id: 'btn_sim', title: '✅ Sim' },
    { id: 'btn_nao', title: '❌ Não' }
  ]
);
```

---

## 🎨 BOAS PRÁTICAS

### ✅ DO

- **Limite de 20 caracteres** no título dos botões
- **Texto claro** e direto ("Sim, salvar" melhor que "OK")
- **Emojis pontuais** (✅, ❌, 📊) para identificação rápida
- **Máximo 3 botões** em Reply Buttons
- **Máximo 10 items** em List Messages

### ❌ DON'T

- Textos longos nos botões ("Sim, por favor confirme e registre" ❌)
- Mais de 3 Reply Buttons (use List Message)
- Emojis excessivos (❤️🔥💯😍 ❌)
- IDs genéricos (`btn_1`, `btn_2` - use `btn_confirmar_receita`)

---

## 🧪 TESTES

### Como testar botões

1. Use o **Postman** ou **Insomnia** para enviar mensagens
2. Configure um número de teste no Evolution API
3. Envie a mensagem interativa
4. Clique nos botões e veja o retorno no webhook

### Exemplo de teste com cURL

```bash
curl -X POST https://evolution.guerrizeeg.com.br/message/sendInteractive/lumiz \
  -H "apikey: SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "5565999999999",
    "options": {
      "delay": 1200
    },
    "buttonMessage": {
      "text": "Teste de botões Lumiz",
      "buttons": [
        { "buttonText": "Opção 1", "buttonId": "btn_1" },
        { "buttonText": "Opção 2", "buttonId": "btn_2" }
      ]
    }
  }'
```

---

## 📚 REFERÊNCIAS

- [Evolution API Docs](https://doc.evolution-api.com/)
- [WhatsApp Business API - Interactive Messages](https://developers.facebook.com/docs/whatsapp/guides/interactive-messages)
- [WhatsApp Cloud API Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages)

---

**Documento criado para a equipe Lumiz**
Versão: 1.0
Data: 14/11/2025
