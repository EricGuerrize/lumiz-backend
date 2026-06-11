// Mock do supabase para não depender de .env nem de rede.
// A factory do jest.mock é hoisted, então não pode referenciar variável externa:
// definimos o mock inline e pegamos a referência via require depois.
jest.mock('../../src/db/supabase', () => ({ from: jest.fn() }));

const supabaseMock = require('../../src/db/supabase');
const pacienteService = require('../../src/services/pacienteService');
const { parsePacienteFields } = pacienteService;

describe('parsePacienteFields', () => {
  it('extrai nome e telefone de comando completo (caso feliz)', () => {
    const r = parsePacienteFields('cadastrar paciente Maria Silva, telefone 11999998888');
    expect(r.nome).toBe('Maria Silva');
    expect(r.telefone).toBe('11999998888');
    expect(r.email).toBeNull();
  });

  it('extrai só o nome quando não há campos opcionais', () => {
    const r = parsePacienteFields('novo paciente João');
    expect(r.nome).toBe('João');
    expect(r.telefone).toBeNull();
    expect(r.cpf).toBeNull();
  });

  it('extrai email, cpf e data de nascimento com rótulos', () => {
    const r = parsePacienteFields(
      'cadastrar cliente Ana Paula, email ana@x.com, cpf 123.456.789-09, nascimento 05/12/1990'
    );
    expect(r.nome).toBe('Ana Paula');
    expect(r.email).toBe('ana@x.com');
    expect(r.cpf).toBe('12345678909');
    expect(r.data_nascimento).toBe('1990-12-05');
  });

  it('retorna nome null para texto vazio (caso erro/empty)', () => {
    const r = parsePacienteFields('');
    expect(r.nome).toBeNull();
  });
});

describe('PacienteService DB', () => {
  beforeEach(() => jest.clearAllMocks());

  it('criar insere e retorna o paciente (caso feliz)', async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: 'c1', nome: 'Maria' }, error: null });
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));
    supabaseMock.from.mockReturnValue({ insert });

    const out = await pacienteService.criar('u1', { nome: 'Maria', telefone: '11999998888' });

    expect(supabaseMock.from).toHaveBeenCalledWith('clientes');
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: 'u1', nome: 'Maria', telefone: '11999998888' }),
    ]);
    expect(out).toEqual({ id: 'c1', nome: 'Maria' });
  });

  it('listar retorna [] quando não há userId (empty)', async () => {
    const out = await pacienteService.listar(null);
    expect(out).toEqual([]);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('getResumoHistorico soma valor_total dos atendimentos', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    };
    // último eq resolve a promise
    query.eq
      .mockReturnValueOnce(query)
      .mockResolvedValueOnce({ data: [{ valor_total: '100' }, { valor_total: 50 }], error: null });
    supabaseMock.from.mockReturnValue(query);

    const out = await pacienteService.getResumoHistorico('u1', 'c1');
    expect(out).toEqual({ total_atendimentos: 2, valor_total: 150 });
  });
});
