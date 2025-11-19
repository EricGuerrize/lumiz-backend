# Dockerfile para Railway (fallback se Nixpacks não funcionar)
FROM node:20-alpine

WORKDIR /app

# Copia arquivos de dependências
COPY package*.json ./

# Instala dependências
RUN npm ci --only=production

# Copia código
COPY . .

# Expõe porta
EXPOSE 8080

# Comando de start
CMD ["node", "src/server.js"]

