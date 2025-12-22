# Dockerfile otimizado com multi-stage build
# Stage 1: Build dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Copia arquivos de dependências
COPY package*.json ./

# Instala todas as dependências (incluindo devDependencies para build se necessário)
RUN npm ci --legacy-peer-deps

# Copia código fonte
COPY . .

# Stage 2: Production image
FROM node:20-alpine AS production

WORKDIR /app

# Copia package files
COPY package*.json ./

# Instala apenas dependências de produção
RUN npm ci --only=production --legacy-peer-deps && \
    npm cache clean --force

# Copia código do builder
COPY --from=builder /app/src ./src
COPY --from=builder /app/supabase ./supabase

# Cria usuário não-root para segurança
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expõe porta
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Comando de start
CMD ["node", "src/server.js"]

