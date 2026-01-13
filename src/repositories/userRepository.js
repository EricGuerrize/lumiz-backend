const supabase = require('../db/supabase');
const cacheService = require('../services/cacheService');
const { normalizePhone, getPhoneVariants } = require('../utils/phone');

/**
 * Repositório para acesso a dados de usuários
 * Abstrai acesso ao Supabase e adiciona cache
 */
class UserRepository {
  /**
   * Busca usuário por telefone
   */
  async findByPhone(phone) {
    const normalized = normalizePhone(phone) || phone;
    
    // Try cache first
    const cacheKey = `phone:profile:${normalized}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    const variants = getPhoneVariants(phone);
    let query = supabase.from('profiles').select('*');

    if (variants.length) {
      query = query.in('telefone', variants);
    } else {
      query = query.eq('telefone', normalized);
    }

    const { data, error } = await query.maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    // Cache result (15 minutes)
    if (data) {
      await cacheService.set(cacheKey, data, 900);
    }

    return data || null;
  }

  /**
   * Busca usuário por ID
   */
  async findById(userId) {
    // Try cache first
    const cacheKey = `user:profile:${userId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    // Cache result (15 minutes)
    if (data) {
      await cacheService.set(cacheKey, data, 900);
    }

    return data || null;
  }

  /**
   * Cria novo perfil
   */
  async create(profileData) {
    const { data, error } = await supabase
      .from('profiles')
      .insert(profileData)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Cache o novo perfil
    if (data) {
      if (data.telefone) {
        await cacheService.set(`phone:profile:${data.telefone}`, data, 900);
      }
      if (data.id) {
        await cacheService.set(`user:profile:${data.id}`, data, 900);
      }
    }

    return data;
  }

  /**
   * Atualiza perfil
   */
  async update(userId, updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Invalida cache
    if (data) {
      await cacheService.invalidateUser(userId);
      if (data.telefone) {
        await cacheService.invalidatePhone(data.telefone);
      }
    }

    return data;
  }
}

// Exporta tanto a classe quanto uma instância singleton
// Permite injeção de dependências em testes
const instance = new UserRepository();
module.exports = instance;
module.exports.UserRepository = UserRepository;


