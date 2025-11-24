# Integração OpenAI + Gemini

## Visão Geral

O projeto agora suporta usar **duas IAs diferentes**:
- **OpenAI GPT-4 Vision**: Para processamento de imagens/PDFs (melhor precisão)
- **Google Gemini**: Para processamento de mensagens de texto (custo-benefício)

## Configuração

### 1. Instalar dependência

```bash
npm install openai
```

### 2. Variáveis de Ambiente

Adicione no `.env`:

```env
# OpenAI (opcional - se não configurar, usa apenas Gemini)
OPENAI_API_KEY=sk-...
OPENAI_PREFERRED=true  # true = usa OpenAI para imagens, false = usa Gemini
```

### 3. Como Funciona

- **Se `OPENAI_PREFERRED=true` e `OPENAI_API_KEY` configurado**:
  - Imagens/PDFs → OpenAI GPT-4 Vision
  - Mensagens de texto → Google Gemini (mantém como está)
  - Se OpenAI falhar → Fallback automático para Gemini

- **Se `OPENAI_PREFERRED=false` ou `OPENAI_API_KEY` não configurado**:
  - Tudo → Google Gemini (comportamento atual)

## Vantagens de Cada IA

### OpenAI GPT-4 Vision
✅ Melhor reconhecimento de documentos  
✅ Suporte nativo a PDFs  
✅ Melhor extração de dados estruturados  
✅ Mais preciso em OCR  
❌ Mais caro (~$0.01-0.03 por imagem)  
❌ Pode ter rate limits mais restritivos  

### Google Gemini
✅ Mais barato (gratuito até certo limite)  
✅ Boa performance em português  
✅ API simples  
✅ Já está funcionando  
❌ Pode ter problemas com PDFs complexos  
❌ Menos preciso em alguns casos  

## Custo Estimado

### OpenAI GPT-4 Vision
- **Imagens**: ~$0.01-0.03 por imagem
- **PDFs**: ~$0.02-0.05 por PDF
- **1000 imagens/mês**: ~$10-30

### Google Gemini
- **Gratuito**: 15 RPM (requests per minute)
- **Pago**: $0.075 por 1M tokens (muito barato)

## Recomendação

**Para produção inicial**: Use apenas Gemini (mais barato)  
**Se precisar de mais precisão**: Ative OpenAI para imagens (`OPENAI_PREFERRED=true`)

## Testando

1. Configure `OPENAI_API_KEY` no `.env`
2. Configure `OPENAI_PREFERRED=true`
3. Envie uma imagem/PDF pelo WhatsApp
4. Verifique os logs:
   - `[DOC] Usando OpenAI GPT-4 Vision...` = usando OpenAI
   - `[DOC] Chamando Gemini API...` = usando Gemini

## Fallback Automático

Se OpenAI falhar (rate limit, erro, etc), o sistema automaticamente tenta com Gemini. Isso garante que o bot sempre funcione, mesmo se uma IA estiver indisponível.

