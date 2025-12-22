const supabase = require('../db/supabase');
const cacheService = require('../services/cacheService');

/**
 * Repositório para acesso a dados de onboarding
 * Abstrai acesso ao Supabase e adiciona cache
 */
class OnboardingRepository {
  /**
   * Busca estado de onboarding por telefone
   */
  async findByPhone(phone) {
    if (!phone) return null;

    // Try cache first
    const cacheKey = `phone:onboarding:${phone}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    const { data, error } = await supabase
      .from('onboarding_progress')
      .select('*')
      .eq('phone', phone)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    // Cache result (30 minutes)
    if (data) {
      await cacheService.set(cacheKey, data, 1800);
    }

    return data || null;
  }

  /**
   * Cria novo estado de onboarding
   */
  async create(stateData) {
    const { data, error } = await supabase
      .from('onboarding_progress')
      .insert(stateData)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Cache o novo estado
    if (data && data.phone) {
      await cacheService.set(`phone:onboarding:${data.phone}`, data, 1800);
    }

    return data;
  }

  /**
   * Atualiza estado de onboarding
   */
  async update(id, updates) {
    const { data, error } = await supabase
      .from('onboarding_progress')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Invalida cache
    if (data && data.phone) {
      await cacheService.invalidatePhone(data.phone);
    }

    return data;
  }

  /**
   * Busca múltiplos estados (para batch operations)
   */
  async findMany(filters = {}) {
    let query = supabase.from('onboarding_progress').select('*');

    if (filters.stage) {
      query = query.eq('stage', filters.stage);
    }
    if (filters.completed !== undefined) {
      query = query.eq('completed', filters.completed);
    }
    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return data || [];
  }
}

// Exporta tanto a classe quanto uma instância singleton
// Permite injeção de dependências em testes
const instance = new OnboardingRepository();
module.exports = instance;
module.exports.OnboardingRepository = OnboardingRepository;

