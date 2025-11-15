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
      { user_id: userId, name: 'Salário', type: 'entrada' },
      { user_id: userId, name: 'Freelance', type: 'entrada' },
      { user_id: userId, name: 'Investimento', type: 'entrada' },
      { user_id: userId, name: 'Alimentação', type: 'saida' },
      { user_id: userId, name: 'Transporte', type: 'saida' },
      { user_id: userId, name: 'Moradia', type: 'saida' },
      { user_id: userId, name: 'Lazer', type: 'saida' },
      { user_id: userId, name: 'Saúde', type: 'saida' },
      { user_id: userId, name: 'Educação', type: 'saida' },
      { user_id: userId, name: 'Outros', type: 'saida' }
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
