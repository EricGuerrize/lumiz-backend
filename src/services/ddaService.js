/**
 * Serviço de DDA (Débito Direto Autorizado)
 * 
 * DDA permite consultar boletos automaticamente via APIs bancárias.
 * 
 * OPÇÕES DISPONÍVEIS NO BRASIL:
 * 
 * 1. BANCO CENTRAL - API de Boletos (Open Banking)
 *    - Requer certificado digital A1
 *    - Integração complexa, mas oficial
 *    - Documentação: https://www.bcb.gov.br/estabilidadefinanceira/openbanking
 * 
 * 2. BANCO BRADESCO - API DDA
 *    - Requer conta no Bradesco
 *    - Documentação: https://developers.bradesco.com.br/
 * 
 * 3. BANCO ITAÚ - API DDA
 *    - Requer conta no Itaú
 *    - Documentação: https://developer.itau.com.br/
 * 
 * 4. BANCO SANTANDER - API DDA
 *    - Requer conta no Santander
 *    - Documentação: https://developers.santander.com.br/
 * 
 * 5. SERVIÇOS TERCEIROS:
 *    - Gerencianet (Efí): https://dev.gerencianet.com.br/
 *    - Asaas: https://docs.asaas.com/
 *    - PagSeguro: https://dev.pagseguro.uol.com.br/
 *    - Stripe (limitado no Brasil)
 * 
 * 6. SCRAPING (NÃO RECOMENDADO):
 *    - Acesso não oficial a sites bancários
 *    - Violação de termos de uso
 *    - Risco legal
 * 
 * IMPLEMENTAÇÃO RECOMENDADA:
 * 
 * Para implementar DDA, você precisa:
 * 1. Escolher um banco/serviço
 * 2. Obter credenciais de API
 * 3. Configurar certificado digital (se necessário)
 * 4. Implementar autenticação OAuth2 (Open Banking)
 * 5. Consultar boletos via API
 * 6. Processar e registrar no sistema
 */

const supabase = require('../db/supabase');
const evolutionService = require('./evolutionService');
const documentService = require('./documentService');
const { formatarMoeda } = require('../utils/currency');

class DdaService {
  constructor() {
    // Configuração do provedor DDA
    this.provider = process.env.DDA_PROVIDER || null; // 'bradesco', 'itau', 'gerencianet', etc
    this.apiKey = process.env.DDA_API_KEY || null;
    this.apiSecret = process.env.DDA_API_SECRET || null;
    this.enabled = !!(this.provider && this.apiKey);
  }

  /**
   * Consulta boletos pendentes para um usuário
   */
  async consultarBoletos(userId) {
    if (!this.enabled) {
      throw new Error('DDA não configurado. Configure DDA_PROVIDER, DDA_API_KEY e DDA_API_SECRET no .env');
    }

    try {
      // Busca dados bancários do usuário
      const { data: user } = await supabase
        .from('profiles')
        .select('id, cnpj, nome_clinica')
        .eq('id', userId)
        .single();

      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      // Implementação específica por provedor
      switch (this.provider.toLowerCase()) {
        case 'bradesco':
          return await this.consultarBradesco(user);
        case 'itau':
          return await this.consultarItau(user);
        case 'gerencianet':
          return await this.consultarGerencianet(user);
        default:
          throw new Error(`Provedor DDA não suportado: ${this.provider}`);
      }
    } catch (error) {
      console.error('[DDA] Erro ao consultar boletos:', error);
      throw error;
    }
  }

  /**
   * Consulta boletos via Bradesco DDA
   */
  async consultarBradesco(user) {
    // TODO: Implementar integração com API Bradesco
    // Exemplo de estrutura:
    /*
    const response = await axios.post('https://api.bradesco.com.br/dda/boletos', {
      cnpj: user.cnpj,
      // outros parâmetros
    }, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data.boletos.map(boleto => ({
      codigo_barras: boleto.codigoBarras,
      valor: boleto.valor,
      vencimento: boleto.dataVencimento,
      beneficiario: boleto.beneficiario,
      descricao: boleto.descricao
    }));
    */
    throw new Error('Integração Bradesco DDA não implementada ainda');
  }

  /**
   * Consulta boletos via Itaú DDA
   */
  async consultarItau(user) {
    // TODO: Implementar integração com API Itaú
    throw new Error('Integração Itaú DDA não implementada ainda');
  }

  /**
   * Consulta boletos via Gerencianet
   */
  async consultarGerencianet(user) {
    // TODO: Implementar integração com Gerencianet
    throw new Error('Integração Gerencianet DDA não implementada ainda');
  }

  /**
   * Processa boletos recebidos e registra como contas a pagar
   */
  async processarBoletos(userId, boletos) {
    try {
      const contasPagar = [];

      for (const boleto of boletos) {
        // Verifica se já existe
        const { data: existente } = await supabase
          .from('contas_pagar')
          .select('id')
          .eq('user_id', userId)
          .eq('codigo_barras', boleto.codigo_barras)
          .single();

        if (existente) {
          console.log(`[DDA] Boleto ${boleto.codigo_barras} já registrado`);
          continue;
        }

        // Cria conta a pagar
        const { data: conta, error } = await supabase
          .from('contas_pagar')
          .insert({
            user_id: userId,
            descricao: boleto.descricao || 'Boleto DDA',
            valor: parseFloat(boleto.valor),
            data_vencimento: boleto.vencimento,
            categoria: 'Boletos',
            codigo_barras: boleto.codigo_barras,
            status: 'pendente',
            origem: 'dda'
          })
          .select()
          .single();

        if (error) {
          console.error(`[DDA] Erro ao registrar boleto ${boleto.codigo_barras}:`, error);
          continue;
        }

        contasPagar.push(conta);
      }

      return contasPagar;
    } catch (error) {
      console.error('[DDA] Erro ao processar boletos:', error);
      throw error;
    }
  }

  /**
   * Notifica usuário sobre novos boletos encontrados
   */
  async notificarBoletos(phone, boletos) {
    if (boletos.length === 0) {
      return;
    }

    let mensagem = `📋 *Novos boletos encontrados via DDA*\n\n`;
    mensagem += `Encontrei ${boletos.length} boleto(s) pendente(s):\n\n`;

    boletos.slice(0, 5).forEach((boleto, index) => {
      const vencimento = new Date(boleto.data_vencimento).toLocaleDateString('pt-BR');
      mensagem += `${index + 1}. ${boleto.descricao}\n`;
      mensagem += `   💰 ${formatarMoeda(parseFloat(boleto.valor))}\n`;
      mensagem += `   📅 Vence: ${vencimento}\n\n`;
    });

    if (boletos.length > 5) {
      mensagem += `... e mais ${boletos.length - 5} boleto(s)\n\n`;
    }

    mensagem += `Todos foram registrados automaticamente! ✅\n`;
    mensagem += `Para ver todos, manda _"contas a pagar"_`;

    await evolutionService.sendMessage(phone, mensagem);
  }

  /**
   * Executa consulta automática de boletos (chamado via cron)
   */
  async executarConsultaAutomatica() {
    if (!this.enabled) {
      console.log('[DDA] DDA não configurado, pulando consulta automática');
      return [];
    }

    try {
      // Busca usuários com DDA ativado
      const { data: users } = await supabase
        .from('profiles')
        .select('id, telefone, dda_ativo')
        .eq('dda_ativo', true);

      if (!users || users.length === 0) {
        return [];
      }

      const resultados = [];

      for (const user of users) {
        try {
          const boletos = await this.consultarBoletos(user.id);
          const processados = await this.processarBoletos(user.id, boletos);
          
          if (processados.length > 0) {
            await this.notificarBoletos(user.telefone, processados);
            resultados.push({
              userId: user.id,
              boletosEncontrados: boletos.length,
              boletosNovos: processados.length
            });
          }
        } catch (error) {
          console.error(`[DDA] Erro ao processar usuário ${user.id}:`, error);
        }
      }

      return resultados;
    } catch (error) {
      console.error('[DDA] Erro na consulta automática:', error);
      return [];
    }
  }
}

module.exports = new DdaService();

