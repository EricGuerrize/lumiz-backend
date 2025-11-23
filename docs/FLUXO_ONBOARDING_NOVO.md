# 📋 Fluxo do Novo Onboarding (Teste Gratuito)

## 🎯 Objetivo
Onboarding direto, sequencial e baseado em números, sem botões, focado em criar o momento WOW com extração automática de transações.

---

## 🔄 FLUXO COMPLETO

### **1. MENSAGEM INICIAL**
**Usuário envia:** `🔥 Quero organizar o financeiro da minha clínica com a Lumiz! Tenho o convite para o teste gratuito.`

**Bot responde:**
- **Se usuário ANTIGO:** 
  > "Que bom que você voltou! Você já tá com o convite do teste gratuito, perfeito! Esse teste é o primeiro passo: ele vai mostrar como a Lumiz realiza a gestão do seu financeiro pelo WhatsApp em poucos minutos. Depois disso, pra continuar a gestão da sua clínica no dia a dia, aí só com o plano pago mesmo."

- **Se usuário NOVO:**
  > "Oi, prazer! Sou a Lumiz 👋
  > 
  > Sou a IA que vai organizar o financeiro da sua clínica — direto pelo WhatsApp.
  > 
  > Antes de começarmos, veja este vídeo rapidinho para entender como eu te ajudo a controlar tudo sem planilhas.
  > 
  > Vou te ajudar a cuidar das finanças da sua clínica de forma simples, automática e sem complicação.
  > 
  > Para começar seu teste, qual é o nome da sua clínica?"

---

### **2. ONBOARDING BÁSICO**

#### **Step 1: Nome da Clínica**
- **Pergunta:** "Para começar seu teste, qual é o nome da sua clínica?"
- **Resposta do usuário:** Nome da clínica
- **Bot responde:** "Perfeito! 😄"
- **Próxima pergunta:** "E qual o seu nome mesmo? Vou te chamar direitinho aqui 😉"

#### **Step 2: Nome do Usuário**
- **Pergunta:** "E qual o seu nome mesmo? Vou te chamar direitinho aqui 😉"
- **Resposta do usuário:** Nome completo
- **Bot responde:** "Prazer, [Primeiro Nome]! 😊"
- **Próxima pergunta:** "Você é:
  1. Proprietária(o) da clínica
  2. Gestora(o)
  3. Recepcionista
  4. Outra função"

#### **Step 3: Função**
- **Pergunta:** Lista de opções numeradas (1-4)
- **Resposta do usuário:** Número (1, 2, 3 ou 4)
- **Bot responde:** "Ótimo!"
- **Próxima pergunta:** "Hoje você recebe como? (Pode marcar mais de uma)
  1. PIX
  2. Cartão
  3. Dinheiro
  4. Link de pagamento
  5. Outros
  
  Digite os números separados por vírgula (ex: 1,2,3)"

#### **Step 4: Formas de Pagamento**
- **Pergunta:** Lista de opções numeradas (1-5), múltipla escolha
- **Resposta do usuário:** Números separados por vírgula (ex: "1,2,3")
- **Bot responde:** "Perfeito!"
- **Próxima pergunta:** "Em média, quantas vendas você faz por mês?"

#### **Step 5: Vendas por Mês**
- **Pergunta:** "Em média, quantas vendas você faz por mês?"
- **Resposta do usuário:** Número (ex: "30")
- **Bot responde:** "Ótimo, já entendi seu tamanho. Isso vai me ajudar a te entregar relatórios melhores."

---

### **3. MOMENTO WOW - PRIMEIRA VENDA**

#### **Step 6: Primeira Venda**
- **Bot pergunta:** "Agora vamos fazer seu primeiro teste rápido 😄
  
  Me envie uma venda da sua clínica, do jeitinho que você falaria para um amigo."

- **Se usuário pedir exemplo:**
  - **Bot responde:** "Pode ser assim:
    
    'Júlia fez um full face com 12ml, usamos 10 Biogelis volume e 1 Juvederm. Total 15.600, pagou 3.000 no PIX e o resto em 6x no cartão.'
    
    Eu entendo tudo automaticamente."

- **Usuário envia:** 
  - Texto da venda (ex: "Botox 2800 cliente Maria")
  - OU foto de boleto/nota fiscal/PDF/print/documento
  
- **Bot processa automaticamente:**
  - Extrai valor, categoria, cliente, forma de pagamento, parcelas
  - Se for documento/imagem, usa OCR para extrair dados
  
- **Bot confirma:** 
  > "Entrada registrada! 🟣
  > 
  > • Valor: R$ X.XXX,XX
  > • Categoria: [Nome]
  > • Cliente: [Nome] (se houver)
  > 
  > Agora que já sei quanto entrou, bora ver o outro lado do financeiro?
  > 
  > Me envie agora um custo da sua clínica — pode ser algo simples como uma compra de insumo, produto ou maquininha. Se quiser, pode mandar foto do boleto, PDF, nota fiscal ou até um texto."

- **Falha na leitura (Fallback):**
  - Se o usuário disser que está errado ou a confiança for baixa:
    > "Ops, li errado? 😅
    > 
    > Pode digitar o valor e a descrição corretos pra mim? Prometo aprender pro próximo!"


---

### **4. PRIMEIRO CUSTO (VARIÁVEL)**

#### **Step 7: Primeiro Custo**
- **Bot pergunta:** (mensagem acima)
- **Usuário envia:** 
  - Texto (ex: "Comprei 6 frascos de Biogeli, paguei 1.800 no cartão.")
  - OU foto/PDF/documento

- **Bot processa:**
  - Extrai valor, descrição, categoria, forma de pagamento
  - Se mencionar parcelamento mas não especificar, pergunta: "Vi que você mencionou parcelamento. Em quantas vezes foi parcelado?"

- **Bot mostra resumo:**
  > "Show! Aqui está o que registrei:
  > 
  > • Descrição: [Nome]
  > • Quantidade: [X] unidades (se houver)
  > • Valor: R$ X.XXX,XX
  > • Pagamento: [Forma]
  > • Categoria sugerida: Compra de insumo
  > 
  > Agora me diz: esse custo é fixo ou variável?
  > 
  > Digite 1 para Variável ou 2 para Fixo"

#### **Step 8: Tipo de Custo**
- **Pergunta:** Fixo ou Variável? (1 ou 2)
- **Resposta do usuário:** 1 (Variável) ou 2 (Fixo)

**Se escolher 1 (Variável):**
- **Bot responde:** "Perfeito! Lancei como custo variável. Isso me ajuda a entender melhor o comportamento financeiro da sua clínica 💜
  
  Agora falta só um custo fixo pra completar o seu painel inicial.
  
  Me envie algo como aluguel, software, salário, internet… o que for mais fácil pra você."

**Se escolher 2 (Fixo):**
- Vai direto para o resumo final (pula step 9)

---

### **5. SEGUNDO CUSTO (FIXO)**

#### **Step 9: Segundo Custo (apenas se primeiro foi variável)**
- **Bot pergunta:** (mensagem acima)
- **Usuário envia:** 
  - Texto (ex: "Aluguel 5.000")
  - OU foto/PDF/documento

- **Bot processa e mostra:**
  > "Boa! Peguei aqui:
  > 
  > • [Categoria] — R$ X.XXX,XX
  > • Pagamento: [Forma]
  > 
  > Lançar como custo fixo mensal?
  > 
  > Digite 1 para Sim ou 2 para Não"

#### **Step 10: Confirmação Custo Fixo**
- **Pergunta:** Confirmar como fixo mensal? (1 ou 2)
- **Resposta do usuário:** 1 (Sim) ou 2 (Não)

**Se 1 (Sim):**
- Vai para resumo final

**Se 2 (Não):**
- "Ok, pode me enviar outro custo fixo então."
- Volta para Step 9

#### **Step 9.1: Pular Segundo Custo (Opcional)**
- Se o usuário demorar mais de 5 minutos ou digitar "Pular":
  - **Bot responde:** "Sem problemas! Vamos pular essa etapa por enquanto para você ver logo o seu resumo."
  - Vai direto para o resumo final.


---

### **6. RESUMO FINAL (WOW FINAL)**

#### **Step 11: Resumo e Criação de Conta**
- **Bot cria o usuário automaticamente**
- **Bot salva todas as transações registradas**
- **Bot mostra resumo:**
  > "Perfeito! Já organizei suas três primeiras informações 🎉
  > 
  > Aqui vai um resumo inicial, só para você ver como tudo começa a tomar forma:
  > 
  > 📊 *Primeiros dados da sua clínica*
  > 
  > • Receita cadastrada: R$ X.XXX,XX
  > • Custos do mês (parciais):
  >   • Custos variáveis registrados: R$ X.XXX,XX
  >   • Custos fixos registrados: R$ X.XXX,XX
  > • Saldo inicial: R$ X.XXX,XX
  > 
  > (esse saldo muda rápido conforme você registra suas vendas e custos reais)
  > 
  > Com mais dados, te mostro gráficos, histórico, totais, projeções e muito mais — tudo automaticamente 💜
  > 
  > *ACESSE SEUS GRÁFICOS DE LUCRO*
  > 
  > Para ver seus relatórios detalhados e acessar o painel completo, defina sua senha segura aqui:
  > 
  > [LINK DE CADASTRO]
  > 
  > *O que você ganha acessando o painel:*
  > • Gráficos de evolução de lucro
  > • Histórico completo das transações
  > • Gestão avançada de categorias
  > 
  > *Importante:*
  > • O link é válido por 48 horas
  > • Você pode continuar usando o WhatsApp normalmente enquanto isso
  > 
  > Assim que finalizar o cadastro, eu te aviso aqui no WhatsApp! 😊"

---

## 📝 REGRAS IMPORTANTES

1. **Tudo baseado em números** - Sem botões, apenas números (1, 2, 3, etc.)
2. **Extração automática** - Aceita texto, foto, PDF, boleto, nota fiscal
3. **Sem pular etapas** - Fluxo sequencial e direto
4. **Momento WOW** - Extração automática mostra o poder da IA
5. **Resumo final** - Mostra dados coletados de forma visual
6. **Não calcula margem** - Apenas mostra receita e custos (sem métricas imprecisas)

---

## 🔧 IMPLEMENTAÇÃO TÉCNICA

### Steps do Onboarding:
1. `nome_clinica` - Nome da clínica
2. `nome_completo` - Nome do usuário
3. `funcao` - Função (1-4)
4. `formas_pagamento` - Formas de pagamento (múltipla escolha)
5. `vendas_mes` - Quantas vendas por mês
6. `primeira_venda` - Primeira venda (texto ou documento)
7. `primeiro_custo` - Primeiro custo (texto ou documento)
8. `primeiro_custo_parcelas` - Parcelas (se necessário)
9. `primeiro_custo_tipo` - Fixo ou Variável (1 ou 2)
10. `segundo_custo` - Segundo custo fixo (se primeiro foi variável)
11. `segundo_custo_confirmacao` - Confirmação custo fixo (1 ou 2)
12. `resumo_final` - Cria usuário e mostra resumo

### Processamento de Documentos:
- Durante `primeira_venda`, `primeiro_custo` ou `segundo_custo`
- Se receber imagem/PDF, processa com OCR
- Extrai dados automaticamente
- Converte para formato que o Gemini entende
- Continua o fluxo normalmente

---

**Última atualização:** 19/11/2025

