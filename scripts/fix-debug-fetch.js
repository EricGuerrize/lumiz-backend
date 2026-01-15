#!/usr/bin/env node

/**
 * Script para remover instâncias de debug fetch para localhost:7242
 *
 * VULNERABILIDADE CRÍTICA #1: Debug logging vazando dados sensíveis
 *
 * Este script:
 * 1. Encontra todas as instâncias de fetch para localhost:7242
 * 2. Cria backup dos arquivos afetados
 * 3. Remove as instâncias de forma segura
 * 4. Valida que a remoção foi bem-sucedida
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Cores para output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// Regex para encontrar fetch debug (multiline)
const DEBUG_FETCH_REGEX = /fetch\s*\(\s*['"]http:\/\/127\.0\.0\.1:7242[^)]+\)\s*\.catch\s*\([^)]*\)\s*;?/gs;

// Estatísticas
let stats = {
  filesScanned: 0,
  filesWithDebug: 0,
  totalInstances: 0,
  filesBackedUp: 0,
  filesFixed: 0
};

/**
 * Cria diretório de backup
 */
function createBackupDir() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '..', '.backup', `debug-fetch-${timestamp}`);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  return backupDir;
}

/**
 * Escaneia arquivo em busca de debug fetch
 */
function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const matches = content.match(DEBUG_FETCH_REGEX);

  return {
    hasDebug: !!matches,
    count: matches ? matches.length : 0,
    content,
    matches
  };
}

/**
 * Remove debug fetches de um arquivo
 */
function fixFile(filePath, content) {
  const newContent = content.replace(DEBUG_FETCH_REGEX, '');
  fs.writeFileSync(filePath, newContent, 'utf8');
  return newContent;
}

/**
 * Cria backup de um arquivo
 */
function backupFile(filePath, backupDir) {
  const relativePath = path.relative(path.join(__dirname, '..'), filePath);
  const backupPath = path.join(backupDir, relativePath);

  // Criar diretórios necessários
  const backupDirPath = path.dirname(backupPath);
  if (!fs.existsSync(backupDirPath)) {
    fs.mkdirSync(backupDirPath, { recursive: true });
  }

  // Copiar arquivo
  fs.copyFileSync(filePath, backupPath);
}

/**
 * Função principal
 */
async function main() {
  console.log(`${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║  🔧 FIX DEBUG FETCH - Correção de Vulnerabilidade #1     ║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  // FASE 1: ESCANEAR
  console.log(`${colors.yellow}[FASE 1]${colors.reset} Escaneando arquivos...\n`);

  const files = glob.sync('src/**/*.js', {
    cwd: path.join(__dirname, '..'),
    absolute: true
  });

  stats.filesScanned = files.length;
  console.log(`📁 Arquivos encontrados: ${stats.filesScanned}\n`);

  const filesWithDebug = [];

  for (const file of files) {
    const result = scanFile(file);

    if (result.hasDebug) {
      const relativePath = path.relative(path.join(__dirname, '..'), file);
      filesWithDebug.push({
        path: file,
        relativePath,
        count: result.count,
        content: result.content,
        matches: result.matches
      });

      console.log(`${colors.red}🔴${colors.reset} ${relativePath}`);
      console.log(`   └─ ${result.count} instância(s) encontrada(s)`);

      // Mostrar preview das instâncias
      result.matches.forEach((match, idx) => {
        const preview = match.substring(0, 80).replace(/\n/g, ' ');
        console.log(`      ${idx + 1}. ${colors.yellow}${preview}...${colors.reset}`);
      });
      console.log('');

      stats.filesWithDebug++;
      stats.totalInstances += result.count;
    }
  }

  if (stats.filesWithDebug === 0) {
    console.log(`${colors.green}✅ Nenhum debug fetch encontrado!${colors.reset}\n`);
    process.exit(0);
  }

  console.log(`${colors.red}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.red}📊 TOTAL: ${stats.totalInstances} instâncias em ${stats.filesWithDebug} arquivos${colors.reset}`);
  console.log(`${colors.red}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  // FASE 2: CONFIRMAR
  if (process.argv.includes('--dry-run')) {
    console.log(`${colors.yellow}⚠️  Modo DRY RUN - Nenhuma alteração será feita${colors.reset}\n`);
    process.exit(0);
  }

  if (!process.argv.includes('--yes')) {
    console.log(`${colors.yellow}⚠️  Execute com --yes para confirmar a remoção${colors.reset}`);
    console.log(`${colors.yellow}   Exemplo: node scripts/fix-debug-fetch.js --yes${colors.reset}\n`);
    process.exit(0);
  }

  // FASE 3: BACKUP
  console.log(`${colors.yellow}[FASE 2]${colors.reset} Criando backup...\n`);

  const backupDir = createBackupDir();
  console.log(`💾 Diretório de backup: ${backupDir}\n`);

  for (const file of filesWithDebug) {
    backupFile(file.path, backupDir);
    stats.filesBackedUp++;
    console.log(`${colors.green}✅${colors.reset} Backup: ${file.relativePath}`);
  }

  console.log(`\n${colors.green}✅ ${stats.filesBackedUp} arquivos com backup${colors.reset}\n`);

  // FASE 4: REMOVER
  console.log(`${colors.yellow}[FASE 3]${colors.reset} Removendo debug fetches...\n`);

  for (const file of filesWithDebug) {
    try {
      fixFile(file.path, file.content);
      stats.filesFixed++;
      console.log(`${colors.green}✅${colors.reset} Corrigido: ${file.relativePath} (${file.count} instâncias removidas)`);
    } catch (error) {
      console.error(`${colors.red}❌${colors.reset} Erro ao corrigir ${file.relativePath}:`, error.message);
    }
  }

  console.log(`\n${colors.green}✅ ${stats.filesFixed} arquivos corrigidos${colors.reset}\n`);

  // FASE 5: VALIDAR
  console.log(`${colors.yellow}[FASE 4]${colors.reset} Validando remoção...\n`);

  let remainingInstances = 0;
  for (const file of files) {
    const result = scanFile(file);
    if (result.hasDebug) {
      const relativePath = path.relative(path.join(__dirname, '..'), file);
      console.log(`${colors.red}❌${colors.reset} Ainda restam ${result.count} instâncias em: ${relativePath}`);
      remainingInstances += result.count;
    }
  }

  if (remainingInstances > 0) {
    console.log(`\n${colors.red}❌ FALHA: ${remainingInstances} instâncias ainda restam!${colors.reset}\n`);
    process.exit(1);
  }

  console.log(`${colors.green}✅ Validação OK: 0 instâncias restantes${colors.reset}\n`);

  // RESUMO FINAL
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.cyan}📊 RESUMO DA CORREÇÃO${colors.reset}`);
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`Arquivos escaneados:     ${stats.filesScanned}`);
  console.log(`Arquivos com debug:      ${stats.filesWithDebug}`);
  console.log(`Instâncias removidas:    ${colors.green}${stats.totalInstances}${colors.reset}`);
  console.log(`Arquivos com backup:     ${stats.filesBackedUp}`);
  console.log(`Arquivos corrigidos:     ${colors.green}${stats.filesFixed}${colors.reset}`);
  console.log(`Backup em:               ${backupDir}`);
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  console.log(`${colors.green}✅ VULNERABILIDADE #1 CORRIGIDA COM SUCESSO!${colors.reset}\n`);
  console.log(`${colors.yellow}Próximos passos:${colors.reset}`);
  console.log(`  1. Verificar git diff: ${colors.cyan}git diff src/${colors.reset}`);
  console.log(`  2. Executar testes: ${colors.cyan}npm test${colors.reset}`);
  console.log(`  3. Commitar: ${colors.cyan}git commit -am "security: remove debug fetch (vuln #1)"${colors.reset}\n`);
}

// Executar
main().catch(error => {
  console.error(`${colors.red}❌ Erro fatal:${colors.reset}`, error);
  process.exit(1);
});
