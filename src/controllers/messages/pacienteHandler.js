/**
 * Handler de mensagens — cadastro básico de paciente (item #36).
 *
 * Responsabilidade: orquestrar os intents de paciente (cadastrar, consultar,
 * listar) chamando `pacienteService` e devolvendo a copy de WhatsApp. Quando o
 * paciente já existe no cadastro, abre um fluxo de confirmação (atualizar?)
 * persistido via `conversationRuntimeStateService` com o flow `paciente_cadastro`.
 *
 * Camada: controller. Nunca envia WhatsApp diretamente nem acessa o banco —
 * delega ao service e retorna string para o MessageController.
 */

const pacienteService = require('../../services/pacienteService');
const conversationRuntimeStateService = require('../../services/conversationRuntimeStateService');
const copy = require('../../copy/pacienteWhatsappCopy');

class PacienteHandler {
  constructor() {
    this.FLOW = PacienteHandler.FLOW;
    this.TTL_MS = PacienteHandler.TTL_MS;
  }

  async hasPendingCadastro(phone) {
    const pending = await conversationRuntimeStateService.get(phone, this.FLOW);
    return Boolean(pending?.payload?.stage);
  }

  /**
   * Máquina de estados do fluxo de confirmação (paciente já existe → atualizar?).
   * @returns {Promise<string|null>}
   */
  async handlePendingCadastro(phone, message, user) {
    const pending = await conversationRuntimeStateService.get(phone, this.FLOW);
    const payload = pending?.payload;
    if (!payload?.stage) return null;

    const normalized = String(message || '').trim().toLowerCase();
    const isYes = ['1', 'sim', 's', 'atualizar', 'confirmar'].includes(normalized);
    const isNo = ['2', 'não', 'nao', 'n', 'cancelar', 'deixar'].includes(normalized);

    if (payload.stage === 'confirm_update') {
      if (isNo) {
        await conversationRuntimeStateService.clear(phone, this.FLOW);
        return copy.atualizacaoCancelada();
      }
      if (isYes) {
        const atualizado = await pacienteService.atualizar(
          user.id,
          payload.clienteId,
          payload.campos || {}
        );
        await conversationRuntimeStateService.clear(phone, this.FLOW);
        return copy.pacienteAtualizado(atualizado);
      }
      // Resposta inesperada: repete a pergunta com os dados existentes.
      return copy.pacienteJaExiste({
        nome: payload.nomeExistente,
        ...(payload.existente || {}),
      });
    }

    return null;
  }

  /**
   * Intent: cadastrar paciente.
   * @returns {Promise<string>}
   */
  async handleCadastrarPaciente(user, phone, message, intent = {}) {
    const campos = pacienteService.parsePacienteFields(message);
    // Permite que a classificação por LLM forneça o nome via dados.cliente.
    if (!campos.nome && intent?.dados?.cliente) {
      campos.nome = String(intent.dados.cliente).trim();
    }
    if (!campos.nome) {
      return copy.precisaNome();
    }

    const existente = await pacienteService.findByNome(user.id, campos.nome);
    if (existente) {
      await conversationRuntimeStateService.upsert(
        phone,
        this.FLOW,
        {
          stage: 'confirm_update',
          clienteId: existente.id,
          nomeExistente: existente.nome,
          existente,
          campos,
        },
        this.TTL_MS
      );
      return copy.pacienteJaExiste(existente);
    }

    const criado = await pacienteService.criar(user.id, campos);
    return copy.pacienteCadastrado(criado);
  }

  /**
   * Intent: consultar dados de um paciente.
   * @returns {Promise<string>}
   */
  async handleConsultarPaciente(user, intent = {}, message = '') {
    const termo =
      intent?.dados?.cliente ||
      intent?.dados?.nome ||
      pacienteService.parsePacienteFields(message).nome;

    if (!termo) {
      return copy.pacienteNaoEncontrado(null);
    }

    const paciente = await pacienteService.findByNome(user.id, termo);
    if (!paciente) {
      return copy.pacienteNaoEncontrado(termo);
    }

    const resumo = await pacienteService.getResumoHistorico(user.id, paciente.id);
    return copy.dadosPaciente(paciente, resumo);
  }

  /**
   * Intent: listar pacientes.
   * @returns {Promise<string>}
   */
  async handleListarPacientes(user) {
    const pacientes = await pacienteService.listar(user.id);
    return copy.listaPacientes(pacientes);
  }
}

PacienteHandler.FLOW = 'paciente_cadastro';
PacienteHandler.TTL_MS = 15 * 60 * 1000;

module.exports = PacienteHandler;
