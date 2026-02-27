#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

const dbUrl = process.env.STAGING_DB_URL;

if (!dbUrl) {
  console.log('ℹ️ STAGING_DB_URL não configurada. Pulando verificação RLS automática.');
  process.exit(0);
}

const sqlPath = path.join(__dirname, 'rls-regression.sql');

function hasPsql() {
  try {
    execSync('psql --version', { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
}

if (!hasPsql()) {
  console.log('ℹ️ psql não está disponível no ambiente. Pulando verificação RLS automática.');
  process.exit(0);
}

try {
  execSync(`psql "${dbUrl}" -v ON_ERROR_STOP=1 -f "${sqlPath}"`, {
    stdio: 'inherit'
  });
  console.log('✅ Verificação RLS executada com sucesso.');
} catch (error) {
  console.error('❌ Falha na verificação RLS:', error.message);
  process.exit(1);
}
