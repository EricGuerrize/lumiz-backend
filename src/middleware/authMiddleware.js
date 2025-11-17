const supabase = require('../db/supabase');

// Middleware de autenticação usando Supabase JWT
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Token de acesso requerido' });
    }

    // Verifica o token com Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(403).json({ error: 'Token inválido ou expirado' });
    }

    // Busca o perfil do usuário
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return res.status(403).json({ error: 'Perfil não encontrado' });
    }

    // Adiciona usuário e perfil ao request
    req.user = profile;
    req.authUser = user;
    next();
  } catch (error) {
    console.error('Erro de autenticação:', error);
    res.status(500).json({ error: 'Erro interno de autenticação' });
  }
};

// Middleware opcional - aceita token OU telefone (para retrocompatibilidade)
const authenticateFlexible = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const phone = req.headers['x-user-phone'];

    // Prioriza token se disponível
    if (token) {
      const { data: { user }, error } = await supabase.auth.getUser(token);

      if (!error && user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (profile) {
          req.user = profile;
          req.authUser = user;
          return next();
        }
      }
    }

    // Fallback para telefone (retrocompatibilidade)
    if (phone) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('telefone', phone)
        .single();

      if (profile) {
        req.user = profile;
        return next();
      }
    }

    return res.status(401).json({ error: 'Autenticação requerida' });
  } catch (error) {
    console.error('Erro de autenticação:', error);
    res.status(500).json({ error: 'Erro interno de autenticação' });
  }
};

module.exports = { authenticateToken, authenticateFlexible };
