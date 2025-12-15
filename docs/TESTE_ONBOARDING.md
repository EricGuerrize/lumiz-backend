# 🧪 Guia de Teste Completo do Onboarding e Bot

## 📋 Visão Geral

Este documento descreve como executar testes completos do sistema Lumiz, desde o onboarding até o processamento de imagens.

## 🚀 Como Executar

### Teste Automatizado Completo

```bash
node test-onboarding-completo.js
```

Este script testa:
1. ✅ Variáveis de ambiente
2. ✅ Conexão com Supabase
3. ✅ Fluxo completo de onboarding (9 etapas)
4. ✅ Funcionalidades do bot (registrar venda, custo, consultar saldo)
5. ✅ Processamento de imagens
6. ✅ Verificação de dados no banco

## 📝 O que o Teste Faz

### 1. Limpeza Inicial
- Remove dados de testes anteriores
- Limpa estado de onboarding em memória

### 2. Verificação de Ambiente
- Verifica variáveis de ambiente obrigatórias
- Testa conexão com Supabase

### 3. Fluxo de Onboarding
Simula um usuário completo passando por:
1. Mensagem inicial ("quero organizar")
2. Seleção de tipo de clínica
3. Nome da clínica
4. Cidade/UF
5. Responsável com CPF/CNPJ
6. Email
7. WhatsApp
8. Confirmação do teste
9. Finalização

### 4. Funcionalidades do Bot
Testa após onboarding completo:
- Registrar venda
- Registrar custo
- Consultar saldo
- Ver histórico

### 5. Processamento de Imagem
- Verifica configuração de serviços de imagem
- Testa estrutura de processamento

### 6. Verificação no Banco
- Confirma criação do usuário
- Verifica registros de atendimentos
- Verifica registros de contas a pagar

## 🔍 Interpretando Resultados

### ✅ Sucesso
```
✅ [Nome do Teste]: OK
```

### ❌ Falha
```
❌ [Nome do Teste]: [Descrição do erro]
```

### ⚠️ Aviso
```
⚠️  [Nome do Teste]: [Mensagem de aviso]
```

## 🐛 Troubleshooting

### Erro: "Variáveis de ambiente não configuradas"
**Solução:** Verifique o arquivo `.env` e certifique-se de que todas as variáveis obrigatórias estão configuradas:
- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE_NAME`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`

### Erro: "Não foi possível conectar ao banco"
**Solução:** 
1. Verifique se o Supabase está acessível
2. Confirme que `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` estão corretos
3. Verifique sua conexão com a internet

### Erro: "Onboarding falhou"
**Possíveis causas:**
1. Serviço de mensagens (Evolution API) não está respondendo
2. Erro no processamento de mensagens
3. Problema na criação do usuário no banco

**Solução:**
1. Verifique logs do servidor
2. Confirme que a Evolution API está funcionando
3. Verifique permissões no Supabase

### Erro: "Processamento de imagem falhou"
**Possíveis causas:**
1. Google Vision ou Gemini não configurado
2. URL de imagem inválida (no teste usa placeholder)

**Solução:**
1. Configure `GOOGLE_VISION_API_KEY` ou `GOOGLE_APPLICATION_CREDENTIALS`
2. Para teste real, use uma imagem real de comprovante

## 📊 Exemplo de Saída

```
╔════════════════════════════════════════════════════════════════╗
║     TESTE COMPLETO DO ONBOARDING E BOT LUMIZ                  ║
╚════════════════════════════════════════════════════════════════╝

📱 Telefone de teste: 55119991234567

======================================================================
🔧 Verificação de Ambiente
======================================================================
✅ ENV EVOLUTION_API_URL: Configurado
✅ ENV EVOLUTION_API_KEY: Configurado
...

======================================================================
📋 Teste do Fluxo de Onboarding
======================================================================
[TESTE] Início do Onboarding
[USUÁRIO] quero organizar
[BOT] Oi! Eu sou a Lumiz, sua assistente financeira...
✅ Onboarding: Início do Onboarding: Resposta correta
...

📊 Resumo dos Testes
Total de testes: 25
✅ Passou: 23
❌ Falhou: 2
⚠️  Avisos: 0
```

## 🎯 Próximos Passos

Após executar os testes:
1. Revise os erros encontrados
2. Corrija problemas identificados
3. Execute novamente para validar correções
4. Para testes com imagens reais, modifique o script para usar URLs reais

## 📝 Notas

- O teste usa um telefone aleatório para evitar conflitos
- Dados de teste são limpos automaticamente antes de começar
- O teste não envia mensagens reais via WhatsApp (usa simulação)
- Para teste completo com WhatsApp real, use o endpoint `/api/test`
