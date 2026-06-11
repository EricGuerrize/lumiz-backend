jest.mock('../../src/services/pacienteService', () => ({
  parsePacienteFields: jest.fn(),
  findByNome: jest.fn(),
  criar: jest.fn(),
  atualizar: jest.fn(),
  listar: jest.fn(),
  getResumoHistorico: jest.fn(),
}));
jest.mock('../../src/services/conversationRuntimeStateService', () => ({
  get: jest.fn(),
  upsert: jest.fn(),
  clear: jest.fn(),
}));

const PacienteHandler = require('../../src/controllers/messages/pacienteHandler');
const pacienteService = require('../../src/services/pacienteService');
const runtime = require('../../src/services/conversationRuntimeStateService');

describe('PacienteHandler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cadastra paciente novo (caso feliz)', async () => {
    pacienteService.parsePacienteFields.mockReturnValue({ nome: 'Maria Silva', telefone: '11999998888' });
    pacienteService.findByNome.mockResolvedValue(null);
    pacienteService.criar.mockResolvedValue({ nome: 'Maria Silva', telefone: '11999998888' });

    const handler = new PacienteHandler();
    const reply = await handler.handleCadastrarPaciente({ id: 'u1' }, '5565', 'cadastrar paciente Maria Silva, telefone 11999998888');

    expect(pacienteService.criar).toHaveBeenCalledWith('u1', expect.objectContaining({ nome: 'Maria Silva' }));
    expect(reply).toContain('Paciente cadastrado');
    expect(reply).toContain('Maria Silva');
  });

  it('pede o nome quando não consegue extrair (empty/erro)', async () => {
    pacienteService.parsePacienteFields.mockReturnValue({ nome: null });

    const handler = new PacienteHandler();
    const reply = await handler.handleCadastrarPaciente({ id: 'u1' }, '5565', 'cadastrar paciente');

    expect(pacienteService.criar).not.toHaveBeenCalled();
    expect(reply).toContain('preciso pelo menos do');
  });

  it('abre fluxo de confirmação quando paciente já existe', async () => {
    pacienteService.parsePacienteFields.mockReturnValue({ nome: 'Maria', telefone: '11888887777' });
    pacienteService.findByNome.mockResolvedValue({ id: 'c1', nome: 'Maria', telefone: '11111111111' });

    const handler = new PacienteHandler();
    const reply = await handler.handleCadastrarPaciente({ id: 'u1' }, '5565', 'cadastrar paciente Maria');

    expect(runtime.upsert).toHaveBeenCalledWith(
      '5565',
      'paciente_cadastro',
      expect.objectContaining({ stage: 'confirm_update', clienteId: 'c1' }),
      expect.any(Number)
    );
    expect(reply).toContain('Já tenho um paciente');
  });

  it('confirma atualização do paciente existente', async () => {
    runtime.get.mockResolvedValue({
      payload: { stage: 'confirm_update', clienteId: 'c1', nomeExistente: 'Maria', campos: { telefone: '11888887777' } },
    });
    pacienteService.atualizar.mockResolvedValue({ nome: 'Maria', telefone: '11888887777' });

    const handler = new PacienteHandler();
    const reply = await handler.handlePendingCadastro('5565', '1', { id: 'u1' });

    expect(pacienteService.atualizar).toHaveBeenCalledWith('u1', 'c1', { telefone: '11888887777' });
    expect(runtime.clear).toHaveBeenCalledWith('5565', 'paciente_cadastro');
    expect(reply).toContain('Dados atualizados');
  });

  it('consulta paciente inexistente retorna não encontrado (empty)', async () => {
    pacienteService.parsePacienteFields.mockReturnValue({ nome: null });
    pacienteService.findByNome.mockResolvedValue(null);

    const handler = new PacienteHandler();
    const reply = await handler.handleConsultarPaciente({ id: 'u1' }, { dados: { cliente: 'Fulano' } }, 'dados do Fulano');

    expect(reply).toContain('Não encontrei paciente');
  });

  it('lista pacientes com empty state', async () => {
    pacienteService.listar.mockResolvedValue([]);

    const handler = new PacienteHandler();
    const reply = await handler.handleListarPacientes({ id: 'u1' });

    expect(reply).toContain('ainda não tem pacientes');
  });
});
