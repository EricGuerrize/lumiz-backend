# Integração Frontend - Cadastro de Usuário

## Visão Geral

Quando o usuário completa o onboarding básico no WhatsApp, ele recebe um link para se cadastrar no dashboard. O frontend precisa implementar a página de cadastro que:

1. Valida o token recebido na URL
2. Permite que o usuário crie uma conta (email + senha)
3. Vincula o email ao perfil existente (criado durante o onboarding)

## Fluxo

```
WhatsApp → Onboarding básico → Link de cadastro → Frontend → Cadastro → Backend vincula → WhatsApp confirma
```

## Endpoint do Backend

### POST `/api/user/link-email`

Vincula email ao perfil existente após cadastro no frontend.

**Request Body:**
```json
{
  "phone": "5511999999999",
  "token": "uuid-do-token",
  "email": "usuario@email.com",
  "password": "senha123"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Email vinculado com sucesso",
  "userId": "uuid-do-usuario"
}
```

**Erros possíveis:**
- `400` - Token inválido ou expirado
- `400` - Email já cadastrado
- `404` - Perfil não encontrado
- `500` - Erro interno

## O que o Frontend precisa fazer

### 1. Página de Cadastro (`/register`)

**URL esperada:** `https://lumiz-financeiro.vercel.app/register?phone={phone}&token={token}`

**Componente React (exemplo):**

```tsx
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from './lib/supabase';

export default function RegisterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const phone = searchParams.get('phone');
  const token = searchParams.get('token');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(true);

  // Valida token ao carregar a página
  useEffect(() => {
    if (!phone || !token) {
      setError('Link inválido. Por favor, use o link enviado pelo WhatsApp.');
      setValidating(false);
      return;
    }

    // Aqui você pode validar o token chamando o backend se quiser
    // Por enquanto, apenas verifica se os parâmetros existem
    setValidating(false);
  }, [phone, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Preencha todos os campos');
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    setLoading(true);

    try {
      // Chama o endpoint do backend para vincular email
      const response = await fetch('https://seu-backend.railway.app/api/user/link-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone,
          token,
          email,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao criar conta');
      }

      // Após vincular, faz login no Supabase
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        throw new Error('Erro ao fazer login. Tente fazer login manualmente.');
      }

      // Redireciona para o dashboard
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Erro ao criar conta. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (validating) {
    return <div>Validando link...</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <div>
          <h2 className="text-3xl font-bold text-center">Criar Conta</h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Complete seu cadastro para acessar o dashboard
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="seu@email.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Senha
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Mínimo 6 caracteres"
              minLength={6}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
              Confirmar Senha
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Digite a senha novamente"
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {loading ? 'Criando conta...' : 'Criar Conta'}
          </button>
        </form>

        <p className="text-xs text-center text-gray-500">
          Ao criar sua conta, você concorda com nossos termos de uso.
        </p>
      </div>
    </div>
  );
}
```

### 2. Validações Importantes

- ✅ Verificar se `phone` e `token` existem na URL
- ✅ Validar formato de email
- ✅ Senha com mínimo de 6 caracteres
- ✅ Confirmar senha
- ✅ Tratar erros do backend (token inválido, email já cadastrado, etc.)

### 3. Após Cadastro Bem-sucedido

1. Fazer login automático no Supabase com as credenciais criadas
2. Redirecionar para `/dashboard`
3. O backend enviará automaticamente uma mensagem de confirmação no WhatsApp

## Variáveis de Ambiente Necessárias

```env
VITE_API_URL=https://seu-backend.railway.app
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-anon-key
```

## Teste

1. Complete o onboarding no WhatsApp
2. Copie o link recebido
3. Acesse no navegador
4. Preencha email e senha
5. Verifique se:
   - Conta é criada
   - Login automático funciona
   - Mensagem de confirmação chega no WhatsApp

## Notas

- O token é válido por 48 horas
- O link só pode ser usado uma vez (Backend deve invalidar o token imediatamente após o uso)
- Se o token expirar, o usuário precisa pedir um novo link no WhatsApp
- O backend cria automaticamente a role de "admin" para o usuário

