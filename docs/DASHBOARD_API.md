# Dashboard API - Lumiz

## Visão Geral

API REST para alimentar o dashboard web do Lumiz hospedado no Lovable.

**Base URL:** `https://seu-backend.railway.app/api/dashboard`

## Autenticação

Todas as requisições precisam incluir o header `x-user-phone` com o número de telefone do usuário (sem formatação, apenas números).

```bash
curl -H "x-user-phone: 5511999999999" https://api.exemplo.com/api/dashboard/summary
```

## Endpoints

### 1. GET `/summary` - Resumo Geral

Retorna os cards principais do dashboard (receitas, custos, lucro, margem).

**Response:**
```json
{
  "receitas": 15000.00,
  "custos": 8500.00,
  "lucro": 6500.00,
  "margemLucro": 43.3,
  "saldo": 6500.00
}
```

---

### 2. GET `/transactions?limit=10` - Transações Recentes

Retorna as últimas transações do usuário.

**Query Params:**
- `limit` (opcional): Número de transações (default: 10)

**Response:**
```json
[
  {
    "id": "uuid",
    "tipo": "entrada",
    "valor": 1500.00,
    "categoria": "Preenchimento labial",
    "descricao": "Paciente Ana - PIX",
    "data": "2025-11-15",
    "emoji": "💰"
  },
  {
    "id": "uuid",
    "tipo": "saida",
    "valor": 3200.00,
    "categoria": "Insumos",
    "descricao": "Allergan - Boleto",
    "data": "2025-11-14",
    "emoji": "💸"
  }
]
```

---

### 3. GET `/monthly-report?year=2025&month=11` - Relatório Mensal

Retorna relatório completo do mês especificado.

**Query Params:**
- `year` (opcional): Ano (default: ano atual)
- `month` (opcional): Mês 1-12 (default: mês atual)

**Response:**
```json
{
  "periodo": "11/2025",
  "receitas": 15000.00,
  "custos": 8500.00,
  "lucro": 6500.00,
  "margemLucro": 43.3,
  "totalMovimentacoes": 25,
  "categorias": {
    "Botox": { "total": 5600.00, "tipo": "entrada" },
    "Preenchimento labial": { "total": 4500.00, "tipo": "entrada" },
    "Insumos": { "total": 6200.00, "tipo": "saida" }
  },
  "transacoes": [
    {
      "id": "uuid",
      "tipo": "entrada",
      "valor": 1500.00,
      "categoria": "Preenchimento labial",
      "descricao": "Paciente Ana",
      "data": "2025-11-15"
    }
  ]
}
```

---

### 4. GET `/categories` - Lista de Categorias

Retorna todas as categorias do usuário (receitas e custos).

**Response:**
```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "name": "Botox / Toxina Botulínica",
    "type": "entrada",
    "created_at": "2025-11-01T00:00:00Z"
  },
  {
    "id": "uuid",
    "user_id": "uuid",
    "name": "Insumos / Produtos",
    "type": "saida",
    "created_at": "2025-11-01T00:00:00Z"
  }
]
```

---

### 5. GET `/stats/by-category?year=2025&month=11` - Top Categorias

Retorna as top 10 categorias de receitas e custos do mês.

**Query Params:**
- `year` (opcional): Ano (default: ano atual)
- `month` (opcional): Mês 1-12 (default: mês atual)

**Response:**
```json
{
  "receitas": [
    {
      "categoria": "Botox",
      "valor": 5600.00,
      "tipo": "entrada"
    },
    {
      "categoria": "Preenchimento labial",
      "valor": 4500.00,
      "tipo": "entrada"
    }
  ],
  "custos": [
    {
      "categoria": "Insumos",
      "valor": 6200.00,
      "tipo": "saida"
    },
    {
      "categoria": "Marketing",
      "valor": 1500.00,
      "tipo": "saida"
    }
  ]
}
```

---

### 6. GET `/stats/timeline?year=2025&month=11` - Timeline Diária

Retorna dados agrupados por dia para gráficos de linha temporal.

**Query Params:**
- `year` (opcional): Ano (default: ano atual)
- `month` (opcional): Mês 1-12 (default: mês atual)

**Response:**
```json
[
  {
    "data": "2025-11-01",
    "receitas": 3500.00,
    "custos": 1200.00,
    "lucro": 2300.00
  },
  {
    "data": "2025-11-02",
    "receitas": 4200.00,
    "custos": 2100.00,
    "lucro": 2100.00
  }
]
```

---

### 7. GET `/user` - Informações do Usuário

Retorna dados básicos do usuário autenticado.

**Response:**
```json
{
  "id": "uuid",
  "phone": "5511999999999",
  "createdAt": "2025-11-01T00:00:00Z"
}
```

---

## Exemplo de Integração no Frontend (React/Vue)

### 1. Criar um serviço API

```javascript
// services/api.js
const API_BASE_URL = 'https://seu-backend.railway.app/api/dashboard';

// Armazene o telefone do usuário no localStorage após login
const getUserPhone = () => localStorage.getItem('userPhone');

export const dashboardApi = {
  async getSummary() {
    const response = await fetch(`${API_BASE_URL}/summary`, {
      headers: {
        'x-user-phone': getUserPhone()
      }
    });
    return response.json();
  },

  async getTransactions(limit = 10) {
    const response = await fetch(`${API_BASE_URL}/transactions?limit=${limit}`, {
      headers: {
        'x-user-phone': getUserPhone()
      }
    });
    return response.json();
  },

  async getMonthlyReport(year, month) {
    const url = new URL(`${API_BASE_URL}/monthly-report`);
    if (year) url.searchParams.set('year', year);
    if (month) url.searchParams.set('month', month);

    const response = await fetch(url, {
      headers: {
        'x-user-phone': getUserPhone()
      }
    });
    return response.json();
  },

  async getTimeline(year, month) {
    const url = new URL(`${API_BASE_URL}/stats/timeline`);
    if (year) url.searchParams.set('year', year);
    if (month) url.searchParams.set('month', month);

    const response = await fetch(url, {
      headers: {
        'x-user-phone': getUserPhone()
      }
    });
    return response.json();
  }
};
```

### 2. Usar no componente React

```jsx
import { useState, useEffect } from 'react';
import { dashboardApi } from './services/api';

function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [summaryData, transactionsData] = await Promise.all([
          dashboardApi.getSummary(),
          dashboardApi.getTransactions(10)
        ]);

        setSummary(summaryData);
        setTransactions(transactionsData);
      } catch (error) {
        console.error('Erro ao carregar dados:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) return <div>Carregando...</div>;

  return (
    <div>
      <h1>Dashboard Lumiz</h1>

      {/* Cards de Resumo */}
      <div className="cards">
        <div className="card">
          <h3>Receitas</h3>
          <p>R$ {summary?.receitas.toFixed(2)}</p>
        </div>
        <div className="card">
          <h3>Custos</h3>
          <p>R$ {summary?.custos.toFixed(2)}</p>
        </div>
        <div className="card">
          <h3>Lucro</h3>
          <p>R$ {summary?.lucro.toFixed(2)}</p>
          <small>{summary?.margemLucro}% margem</small>
        </div>
      </div>

      {/* Transações Recentes */}
      <div className="transactions">
        <h2>Últimas Transações</h2>
        {transactions.map(t => (
          <div key={t.id} className="transaction">
            <span>{t.emoji}</span>
            <div>
              <strong>{t.categoria}</strong>
              <small>{t.descricao}</small>
            </div>
            <span className={t.tipo}>
              {t.tipo === 'entrada' ? '+' : '-'}R$ {t.valor.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Autenticação Simples

Para tela de login no Lovable, basta pedir o número de telefone:

```jsx
function Login() {
  const [phone, setPhone] = useState('');

  const handleLogin = () => {
    // Remove formatação (apenas números)
    const cleanPhone = phone.replace(/\D/g, '');

    // Salva no localStorage
    localStorage.setItem('userPhone', cleanPhone);

    // Redireciona para dashboard
    window.location.href = '/dashboard';
  };

  return (
    <div>
      <h1>Login Lumiz</h1>
      <input
        type="tel"
        placeholder="(11) 99999-9999"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <button onClick={handleLogin}>Entrar</button>
    </div>
  );
}
```

---

## Tratamento de Erros

Todos os endpoints retornam erros no formato:

```json
{
  "error": "Mensagem de erro descritiva"
}
```

**Status Codes:**
- `200` - Sucesso
- `401` - Header `x-user-phone` não fornecido
- `500` - Erro interno do servidor

---

## Próximos Passos

- [ ] Implementar autenticação JWT (opcional)
- [ ] Adicionar endpoint para criar transações via dashboard
- [ ] Adicionar filtros avançados (por categoria, período customizado)
- [ ] Implementar webhook para notificar dashboard em tempo real
- [ ] Adicionar exportação de relatórios (PDF/Excel)
