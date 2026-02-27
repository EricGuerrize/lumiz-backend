#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

if (!fs.existsSync(migrationsDir)) {
  fail(`Diretório de migrations não encontrado: ${migrationsDir}`);
}

const files = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  fail('Nenhuma migration .sql encontrada em supabase/migrations');
}

const pattern = /^\d{14}_[a-z0-9_\-]+\.sql$/;
const invalidNames = files.filter((name) => !pattern.test(name));
if (invalidNames.length > 0) {
  fail(`Arquivos com nome inválido: ${invalidNames.join(', ')}. Use formato YYYYMMDDHHMMSS_descricao.sql`);
}

const seenPrefixes = new Set();
for (const name of files) {
  const prefix = name.slice(0, 14);
  if (seenPrefixes.has(prefix)) {
    fail(`Timestamp duplicado detectado nas migrations: ${prefix}`);
  }
  seenPrefixes.add(prefix);
}

const sorted = [...files].sort((a, b) => a.localeCompare(b));
for (let i = 0; i < files.length; i += 1) {
  if (files[i] !== sorted[i]) {
    fail('Ordem das migrations está inconsistente. Verifique timestamp e nomes.');
  }
}

console.log(`✅ Migrations válidas (${files.length} arquivos).`);
