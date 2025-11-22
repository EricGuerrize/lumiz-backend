# 🔍 RAG (Retrieval-Augmented Generation) - Explicação Prática

## O que é RAG?

**RAG = Buscar exemplos similares + Usar no prompt**

Em vez de o bot sempre usar o mesmo prompt genérico, ele:
1. **Busca** conversas anteriores que foram bem-sucedidas e similares à mensagem atual
2. **Injeta** esses exemplos no prompt antes de chamar o Gemini
3. **Melhora** a resposta porque o modelo vê casos reais que funcionaram

---

## 🎯 Como Funciona (Exemplo Prático)

### **Sem RAG (Atual):**
```
Usuário: "tox 2800"
Bot: [Gemini usa prompt genérico]
Bot: "Não entendi. Você quis dizer botox?"
```

### **Com RAG:**
```
Usuário: "tox 2800"

1. Sistema busca no banco:
   - "tox 2500" → funcionou → {"intencao":"registrar_entrada","categoria":"Botox"}
   - "tox 3000 maria" → funcionou → {"intencao":"registrar_entrada","categoria":"Botox"}

2. Injeta no prompt:
   "Exemplos similares que funcionaram:
   - 'tox 2500' → registrar_entrada, categoria Botox
   - 'tox 3000 maria' → registrar_entrada, categoria Botox
   
   Agora responda para: 'tox 2800'"

3. Gemini vê os exemplos e acerta:
   Bot: "💰 Registrando entrada de R$ 2.800 para Botox. Confirma?"
```

---

## 🏗️ Arquitetura RAG Simples

```
┌─────────────────┐
│  Mensagem do    │
│    Usuário      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Buscar Exemplos│  ← Busca no banco conversas similares
│   Similares     │     que tiveram feedback positivo
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Injetar no     │  ← Adiciona exemplos ao prompt
│     Prompt      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Gemini API    │  ← Gera resposta melhorada
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Resposta      │
│   Melhorada     │
└─────────────────┘
```

---

## 💡 Para que Serve?

### 1. **Aprende com Casos Reais**
- Não precisa retreinar modelo
- Aprende com uso real do bot
- Melhora automaticamente com o tempo

### 2. **Adapta-se ao Nicho**
- Aprende termos específicos de cada clínica
- "tox" para uma clínica = botox
- "preench" para outra = preenchimento labial

### 3. **Reduz Erros Comuns**
- Se usuário sempre corrige "X" para "Y"
- Sistema aprende e para de errar
- Melhora contínua

### 4. **Personalização por Usuário**
- Cada clínica tem seu jeito de falar
- Bot aprende o vocabulário específico
- Respostas mais precisas

---

## ✅ É Viável para o Lumiz?

### **SIM, porque:**

1. **Volume de dados cresce naturalmente**
   - Cada conversa é um exemplo
   - Com 100-200 conversas já funciona
   - Melhora exponencialmente

2. **Custo baixo**
   - Embeddings: ~$5-10/mês (Supabase pgvector ou OpenAI)
   - Ou até grátis (similaridade por texto simples)

3. **Implementação simples**
   - Não precisa de ML complexo
   - Apenas busca + injeção no prompt
   - 2-3 dias de trabalho

4. **ROI alto**
   - Melhora imediata na acurácia
   - Reduz "não entendi"
   - Melhor experiência

---

## 🤔 Faz Sentido para o Projeto?

### **SIM, faz muito sentido porque:**

1. **Bot nichado** (clínicas estéticas)
   - Termos específicos do nicho
   - RAG aprende esses termos naturalmente
   - Sem precisar hardcode

2. **Usuários repetem padrões**
   - "tox 2800" sempre = botox
   - "preench 1500" sempre = preenchimento
   - RAG captura esses padrões

3. **Melhora contínua**
   - Quanto mais usa, melhor fica
   - Sem intervenção manual
   - Escala automaticamente

4. **Baixo risco**
   - Se não funcionar, só desliga
   - Não quebra nada existente
   - Pode testar gradualmente

---

## 🛠️ Como Implementar (Versão Simples)

### **Opção 1: Similaridade por Texto (Grátis)**
```javascript
// Busca conversas com texto similar
const similar = await supabase
  .from('conversation_history')
  .select('*')
  .eq('feedback', 'positive')
  .ilike('user_message', `%${searchTerm}%`)
  .limit(3);
```

**Prós**: Grátis, simples  
**Contras**: Menos preciso que embeddings

### **Opção 2: Embeddings (Recomendado)**
```javascript
// 1. Gerar embedding da mensagem atual (OpenAI ou Supabase)
const embedding = await generateEmbedding(message);

// 2. Buscar similares no banco (pgvector)
const similar = await supabase.rpc('match_conversations', {
  query_embedding: embedding,
  match_threshold: 0.7,
  match_count: 3
});

// 3. Injetar no prompt
prompt += `\n\nExemplos similares que funcionaram:\n${similar.map(...)}`;
```

**Prós**: Muito preciso, escala bem  
**Contras**: Custo ~$5-10/mês

---

## 📊 Exemplo Prático de Implementação

### **Fluxo Completo:**

```javascript
// 1. Usuário envia mensagem
const message = "tox 2800";

// 2. Buscar exemplos similares
const examples = await ragService.findSimilarExamples(message, userId, 3);
// Retorna:
// [
//   { user_message: "tox 2500", bot_response: "...", intent: "registrar_entrada" },
//   { user_message: "tox 3000 maria", bot_response: "...", intent: "registrar_entrada" }
// ]

// 3. Construir prompt com exemplos
const prompt = `
... (prompt base) ...

EXEMPLOS SIMILARES QUE FUNCIONARAM:
${examples.map(ex => 
  `Usuário: "${ex.user_message}" → ${ex.intent}`
).join('\n')}

Agora responda para: "${message}"
`;

// 4. Gemini usa os exemplos e acerta melhor
const intent = await gemini.process(prompt);
```

---

## 💰 Custo Estimado

### **Opção Simples (Texto):**
- Custo: $0
- Tempo: 1 dia
- Precisão: 70-80%

### **Opção Embeddings:**
- Custo: $5-10/mês
- Tempo: 2-3 dias
- Precisão: 85-95%

---

## 🎯 Quando Vale a Pena?

### **Vale a pena SE:**
- ✅ Tem >100 conversas armazenadas
- ✅ Usuários repetem padrões
- ✅ Quer melhorar sem retreinar modelo
- ✅ Orçamento permite $5-10/mês

### **NÃO vale a pena SE:**
- ❌ Tem <50 conversas
- ❌ Cada conversa é única (sem padrões)
- ❌ Orçamento muito apertado
- ❌ Prompt atual já funciona 95%+

---

## 🚀 Recomendação para Lumiz

### **Fase 1: Testar com Similaridade Simples (AGORA)**
- Implementar busca por texto similar
- Custo: $0
- Tempo: 1 dia
- Ver se melhora

### **Fase 2: Se funcionar, migrar para Embeddings (DEPOIS)**
- Implementar embeddings
- Custo: $5-10/mês
- Tempo: 2-3 dias
- Melhor precisão

---

## 📝 Resumo

**RAG é:**
- Buscar exemplos similares do passado
- Mostrar para o modelo antes de responder
- Modelo aprende com casos reais

**Para Lumiz:**
- ✅ Faz sentido (bot nichado)
- ✅ É viável (custo baixo)
- ✅ Melhora contínua
- ✅ Baixo risco

**Recomendação:**
- Começar com versão simples (grátis)
- Se funcionar, evoluir para embeddings
- Testar com 100+ conversas primeiro

---

**Última atualização**: 19/11/2025

