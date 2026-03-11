/**
 * safeLogger — Supressão de console.log em produção
 *
 * Em produção, console.log/debug ficam silenciosos para evitar que dados
 * operacionais (nomes de pacientes, valores, tokens) vazem no stdout do
 * servidor (Railway / VPS).
 *
 * console.error e console.warn permanecem ativos em todos os ambientes
 * para que erros críticos continuem visíveis nos alertas de infra.
 *
 * Logs estruturados devem usar o Pino (src/config/logger.js), que já tem
 * redact configurado para campos sensíveis.
 *
 * Baseado na diretriz 1.3 do SECURITY_ROADMAP.md.
 */

const IS_PROD = process.env.NODE_ENV === 'production';

if (IS_PROD) {
  // Silencia logs operacionais em produção
  // eslint-disable-next-line no-console
  console.log = () => {};
  // eslint-disable-next-line no-console
  console.debug = () => {};
  // eslint-disable-next-line no-console
  console.info = () => {};

  // console.error e console.warn permanecem intactos
}
