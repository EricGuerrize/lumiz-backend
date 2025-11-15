const supabase = require('../db/supabase');

class UserController {
  async findOrCreateUser(phone) {
    try {
      const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('phone', phone)
        .single();

      if (existingUser) {
        return existingUser;
      }

      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert([{ phone }])
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      await this.createDefaultCategories(newUser.id);

      return newUser;
    } catch (error) {
      console.error('Erro ao buscar/criar usuário:', error);
      throw error;
    }
  }

  async createDefaultCategories(userId) {
    const defaultCategories = [
      // Receitas (Procedimentos Estéticos)
      { user_id: userId, name: 'Botox / Toxina Botulínica', type: 'entrada' },
      { user_id: userId, name: 'Preenchimento Labial', type: 'entrada' },
      { user_id: userId, name: 'Preenchimento Facial', type: 'entrada' },
      { user_id: userId, name: 'Harmonização Facial', type: 'entrada' },
      { user_id: userId, name: 'Bioestimuladores', type: 'entrada' },
      { user_id: userId, name: 'Procedimentos Corporais', type: 'entrada' },
      { user_id: userId, name: 'Outros Procedimentos', type: 'entrada' },

      // Custos (Despesas da Clínica)
      { user_id: userId, name: 'Insumos / Produtos', type: 'saida' },
      { user_id: userId, name: 'Aluguel', type: 'saida' },
      { user_id: userId, name: 'Marketing / Publicidade', type: 'saida' },
      { user_id: userId, name: 'Equipe / Salários', type: 'saida' },
      { user_id: userId, name: 'Energia / Água', type: 'saida' },
      { user_id: userId, name: 'Internet / Telefone', type: 'saida' },
      { user_id: userId, name: 'Manutenção / Equipamentos', type: 'saida' },
      { user_id: userId, name: 'Outros Custos', type: 'saida' }
    ];

    try {
      await supabase.from('categories').insert(defaultCategories);
    } catch (error) {
      console.error('Erro ao criar categorias padrão:', error);
    }
  }

  async updateUserName(userId, name) {
    try {
      const { data, error } = await supabase
        .from('users')
        .update({ name, updated_at: new Date() })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Erro ao atualizar nome:', error);
      throw error;
    }
  }
}

module.exports = new UserController();
