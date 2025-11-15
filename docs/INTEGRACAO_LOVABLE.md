# Guia de Integração Lumiz Backend + Lovable Dashboard

## Resumo

Você tem agora um **backend completo** com API REST pronta para alimentar seu dashboard no Lovable!

---

## 1. Deploy do Backend (Railway)

### Passo 1: Fazer Push para GitHub
```bash
git push origin main
```

### Passo 2: Deploy no Railway
1. Acesse [Railway.app](https://railway.app)
2. Conecte seu repositório GitHub
3. Railway detecta automaticamente o Node.js
4. Anote a URL do backend (ex: `https://lumiz-backend-production.up.railway.app`)

---

## 2. Configuração no Lovable

### Arquivo: `src/config/api.ts` (criar)

```typescript
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://lumiz-backend-production.up.railway.app';

export const dashboardApi = {
  baseUrl: `${API_BASE_URL}/api/dashboard`,

  // Pega o telefone do usuário (salvo no login)
  getHeaders: () => ({
    'Content-Type': 'application/json',
    'x-user-phone': localStorage.getItem('userPhone') || ''
  }),

  // Endpoints
  async getSummary() {
    const res = await fetch(`${this.baseUrl}/summary`, {
      headers: this.getHeaders()
    });
    return res.json();
  },

  async getTransactions(limit = 10) {
    const res = await fetch(`${this.baseUrl}/transactions?limit=${limit}`, {
      headers: this.getHeaders()
    });
    return res.json();
  },

  async getMonthlyReport(year?: number, month?: number) {
    const params = new URLSearchParams();
    if (year) params.set('year', year.toString());
    if (month) params.set('month', month.toString());

    const res = await fetch(`${this.baseUrl}/monthly-report?${params}`, {
      headers: this.getHeaders()
    });
    return res.json();
  },

  async getCategories() {
    const res = await fetch(`${this.baseUrl}/categories`, {
      headers: this.getHeaders()
    });
    return res.json();
  },

  async getStatsByCategory(year?: number, month?: number) {
    const params = new URLSearchParams();
    if (year) params.set('year', year.toString());
    if (month) params.set('month', month.toString());

    const res = await fetch(`${this.baseUrl}/stats/by-category?${params}`, {
      headers: this.getHeaders()
    });
    return res.json();
  },

  async getTimeline(year?: number, month?: number) {
    const params = new URLSearchParams();
    if (year) params.set('year', year.toString());
    if (month) params.set('month', month.toString());

    const res = await fetch(`${this.baseUrl}/stats/timeline?${params}`, {
      headers: this.getHeaders()
    });
    return res.json();
  }
};
```

---

## 3. Tela de Login Simples

### Arquivo: `src/pages/Login.tsx`

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [phone, setPhone] = useState('');
  const navigate = useNavigate();

  const handleLogin = () => {
    // Remove formatação - só números
    const cleanPhone = phone.replace(/\D/g, '');

    if (cleanPhone.length < 10) {
      alert('Digite um telefone válido');
      return;
    }

    // Salva no localStorage
    localStorage.setItem('userPhone', cleanPhone);

    // Redireciona para dashboard
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-600 to-pink-500">
      <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-purple-600 mb-2">Lumiz 💜</h1>
          <p className="text-gray-600">Gestão Financeira para Clínicas</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Número do WhatsApp
            </label>
            <input
              type="tel"
              placeholder="(11) 99999-9999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          <button
            onClick={handleLogin}
            className="w-full bg-purple-600 text-white py-3 rounded-lg font-semibold hover:bg-purple-700 transition-colors"
          >
            Entrar
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center mt-6">
          Use o mesmo número cadastrado no WhatsApp com a Lumiz
        </p>
      </div>
    </div>
  );
}
```

---

## 4. Dashboard Principal

### Arquivo: `src/pages/Dashboard.tsx`

```tsx
import { useState, useEffect } from 'react';
import { dashboardApi } from '../config/api';

interface Summary {
  receitas: number;
  custos: number;
  lucro: number;
  margemLucro: number;
}

interface Transaction {
  id: string;
  tipo: string;
  valor: number;
  categoria: string;
  descricao: string;
  data: string;
  emoji: string;
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [summaryData, transactionsData] = await Promise.all([
        dashboardApi.getSummary(),
        dashboardApi.getTransactions(10)
      ]);

      setSummary(summaryData);
      setTransactions(transactionsData);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      alert('Erro ao carregar dados. Verifique sua conexão.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard Lumiz 💜</h1>
          <p className="text-gray-600">Resumo financeiro da sua clínica</p>
        </div>

        {/* Cards de Resumo */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-green-500">
            <p className="text-sm text-gray-600 mb-1">Receitas</p>
            <p className="text-2xl font-bold text-green-600">
              R$ {summary?.receitas.toFixed(2)}
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-red-500">
            <p className="text-sm text-gray-600 mb-1">Custos</p>
            <p className="text-2xl font-bold text-red-600">
              R$ {summary?.custos.toFixed(2)}
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-purple-500">
            <p className="text-sm text-gray-600 mb-1">Lucro</p>
            <p className="text-2xl font-bold text-purple-600">
              R$ {summary?.lucro.toFixed(2)}
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-blue-500">
            <p className="text-sm text-gray-600 mb-1">Margem de Lucro</p>
            <p className="text-2xl font-bold text-blue-600">
              {summary?.margemLucro.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Transações Recentes */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Últimas Transações
          </h2>

          <div className="space-y-3">
            {transactions.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{t.emoji}</span>
                  <div>
                    <p className="font-semibold text-gray-900">{t.categoria}</p>
                    <p className="text-sm text-gray-600">{t.descricao}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(t.data).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </div>

                <p
                  className={`font-bold text-lg ${
                    t.tipo === 'entrada' ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {t.tipo === 'entrada' ? '+' : '-'}R$ {t.valor.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## 5. Variáveis de Ambiente no Lovable

Crie um arquivo `.env` no Lovable:

```env
VITE_API_URL=https://lumiz-backend-production.up.railway.app
```

---

## 6. Testando a Integração

### Teste 1: Login
1. Abra o dashboard do Lovable
2. Faça login com um número de telefone que já usou no WhatsApp
3. Deve redirecionar para o dashboard

### Teste 2: Dashboard
1. Verifique se os cards de resumo aparecem
2. Verifique se as transações recentes aparecem
3. Abra o console (F12) e verifique se não há erros

### Teste 3: API Direta (no terminal)
```bash
# Substitua pelo seu número de telefone
curl -H "x-user-phone: 5511999999999" \
  https://lumiz-backend-production.up.railway.app/api/dashboard/summary
```

Deve retornar algo como:
```json
{
  "receitas": 0,
  "custos": 0,
  "lucro": 0,
  "margemLucro": 0,
  "saldo": 0
}
```

---

## 7. Próximos Passos

### Melhorias Recomendadas:

1. **Adicionar gráficos**
   - Use Chart.js ou Recharts
   - Endpoint: `/api/dashboard/stats/timeline`

2. **Filtros por período**
   - Adicione seletor de mês/ano
   - Use os parâmetros `year` e `month` nas requisições

3. **Categorias coloridas**
   - Endpoint: `/api/dashboard/stats/by-category`
   - Mostre top 10 receitas e custos em gráfico de pizza

4. **Autenticação JWT (opcional)**
   - Para maior segurança
   - Implementar login com código SMS

5. **Real-time updates**
   - WebSocket ou polling
   - Atualizar dashboard quando houver nova transação no WhatsApp

---

## 8. Troubleshooting

### Erro de CORS
- Verifique se o domínio do Lovable está em `server.js` (linha 13-17)
- Adicione o domínio correto se necessário

### Erro 401 (Unauthorized)
- Verifique se está enviando o header `x-user-phone`
- Verifique se o telefone está no formato correto (só números)

### Dados vazios
- Certifique-se de que o usuário já registrou transações pelo WhatsApp
- Teste com `/api/dashboard/user` para verificar se o usuário existe

---

## Endpoints Disponíveis

✅ `GET /api/dashboard/summary` - Cards principais
✅ `GET /api/dashboard/transactions?limit=10` - Transações recentes
✅ `GET /api/dashboard/monthly-report?year=2025&month=11` - Relatório mensal
✅ `GET /api/dashboard/categories` - Categorias do usuário
✅ `GET /api/dashboard/stats/by-category` - Top 10 categorias
✅ `GET /api/dashboard/stats/timeline` - Timeline diária
✅ `GET /api/dashboard/user` - Info do usuário

📚 **Documentação completa:** `docs/DASHBOARD_API.md`

---

**Pronto! Seu dashboard está integrado com o backend Lumiz** 🎉
