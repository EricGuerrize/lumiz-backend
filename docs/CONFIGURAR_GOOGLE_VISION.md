# 🔧 Como Configurar Google Vision API

## ✅ Opção 1: API Key Direta (Mais Simples)

### 1. Criar API Key no Google Cloud Console

1. Acesse: https://console.cloud.google.com
2. Selecione seu projeto (ou crie um novo)
3. Vá em **APIs e serviços** > **Credenciais**
4. Clique em **Criar credenciais** > **Chave de API**
5. Copie a chave gerada

### 2. Restringir a API Key (Recomendado)

1. Clique na chave criada para editar
2. Em **Restrições da API**, selecione **Restringir chave**
3. Selecione **Cloud Vision API** na lista
4. Clique em **Salvar**

### 3. Configurar no `.env`

```env
# Google Vision API (para OCR - extração de texto)
GOOGLE_VISION_API_KEY=AIzaSyDgoqVaiYdQPxlpK3o__6NVpdaBRcrpocM

# Gemini API (para processar o texto extraído - ainda necessário)
GEMINI_API_KEY=sua-chave-gemini-aqui
```

### 4. Instalar Dependência

```bash
npm install @google-cloud/vision
```

---

## ✅ Opção 2: Credentials JSON (Mais Seguro - Produção)

### 1. Criar Conta de Serviço

1. No Google Cloud Console, vá em **IAM e administração** > **Contas de serviço**
2. Clique em **Criar conta de serviço**
3. Dê um nome (ex: `vision-api-service`)
4. Clique em **Criar e continuar**

### 2. Conceder Permissões

1. Selecione a role: **Cloud Vision API User**
2. Clique em **Continuar** > **Concluído**

### 3. Criar e Baixar Chave JSON

1. Clique na conta de serviço criada
2. Vá na aba **Chaves**
3. Clique em **Adicionar chave** > **Criar nova chave**
4. Selecione **JSON** e clique em **Criar**
5. O arquivo será baixado automaticamente

### 4. Configurar no `.env`

```env
# Caminho para o arquivo JSON baixado
GOOGLE_APPLICATION_CREDENTIALS=/caminho/para/credentials.json

# Gemini API (ainda necessário para processar texto)
GEMINI_API_KEY=sua-chave-gemini-aqui
```

---

## 📊 Como Funciona

### Fluxo Completo:

```
1. Imagem recebida
   ↓
2. Google Vision API (OCR)
   - Extrai TODO o texto da imagem
   - Usa sua API key: AIzaSyDgoqVaiYdQPxlpK3o__6NVpdaBRcrpocM
   ↓
3. Gemini (Processamento)
   - Recebe o texto extraído
   - Entende contexto e estrutura
   - Extrai dados estruturados (valor, categoria, data, etc)
   - Usa GEMINI_API_KEY (grátis)
   ↓
4. Retorna JSON com transações
```

### Por que precisa do Gemini?

- **Google Vision**: Só faz OCR (extrai texto bruto)
- **Gemini**: Entende contexto e extrai dados estruturados

**Exemplo**:
- Vision extrai: `"PIX RECEBIDO De: João Silva Para: Maria Santos Valor: R$ 500,00"`
- Gemini processa e retorna:
  ```json
  {
    "tipo_documento": "comprovante_pix",
    "transacoes": [{
      "tipo": "entrada",
      "valor": 500.00,
      "categoria": "João Silva",
      "data": "2025-11-25",
      "descricao": "Pix recebido de João Silva"
    }]
  }
  ```

---

## 🎯 Limites Gratuitos

- **Google Vision API**: 1.000 requisições/mês grátis
- **Gemini**: Ilimitado (até 15 req/min)

**Total**: 1.000 análises de documentos/mês **GRÁTIS** ✅

---

## ⚠️ Importante

1. **API Key Restrita**: Configure restrições na API key para maior segurança
2. **Gemini Necessário**: Você ainda precisa do `GEMINI_API_KEY` para processar o texto
3. **Instalar Pacote**: Execute `npm install @google-cloud/vision`

---

## 🚀 Testar

Após configurar, reinicie o servidor e envie uma imagem. Você verá nos logs:

```
[VISION] ✅ Google Vision inicializado com API key
[VISION] Extraindo texto (OCR) com Google Vision REST API...
[VISION] ✅ Texto extraído: 500 caracteres
[VISION] Processando texto com Gemini para extrair dados...
[VISION] ✅ Dados extraídos com sucesso
```




