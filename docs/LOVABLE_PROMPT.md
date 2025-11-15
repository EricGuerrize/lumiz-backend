# Prompt para Lovable - Dashboard Lumiz Completo

**Cole este documento inteiro no Lovable para ele criar o dashboard completo.**

---

## Contexto do Projeto

Estou criando um dashboard financeiro para clínicas de estética chamado **Lumiz**. O backend já está pronto em Node.js/Express com API REST. Preciso que você crie o frontend completo em React/TypeScript usando Tailwind CSS.

## API Backend

**URL Base:** `https://lumiz-backend-production.up.railway.app` (ou localhost:3000 em dev)

**Autenticação:** Header `x-user-phone` com número do telefone do usuário (apenas números).

## Endpoints Disponíveis

### 1. Resumo Geral
```
GET /api/dashboard/summary
Response: {
  receitas: number,
  custos: number,
  lucro: number,
  margemLucro: number,
  saldo: number
}
```

### 2. Transações Recentes
```
GET /api/dashboard/transactions?limit=10
Response: [{
  id: string,
  tipo: "entrada" | "saida",
  valor: number,
  categoria: string,
  descricao: string,
  data: string,
  emoji: string
}]
```

### 3. Relatório Mensal
```
GET /api/dashboard/monthly-report?year=2025&month=11
Response: {
  periodo: string,
  receitas: number,
  custos: number,
  lucro: number,
  margemLucro: number,
  totalMovimentacoes: number,
  categorias: { [key: string]: { total: number, tipo: string } },
  transacoes: Transaction[]
}
```

### 4. Top Categorias
```
GET /api/dashboard/stats/by-category?year=2025&month=11
Response: {
  receitas: [{ categoria: string, valor: number, tipo: string }],
  custos: [{ categoria: string, valor: number, tipo: string }]
}
```

### 5. Timeline Diária
```
GET /api/dashboard/stats/timeline?year=2025&month=11
Response: [{
  data: string,
  receitas: number,
  custos: number,
  lucro: number
}]
```

### 6. Comparativo Mês a Mês
```
GET /api/dashboard/stats/comparison
Response: {
  mesAtual: { periodo, receitas, custos, lucro, transacoes },
  mesAnterior: { periodo, receitas, custos, lucro, transacoes },
  variacao: { receitas: %, custos: %, lucro: %, transacoes: % }
}
```

### 7. Métricas e Médias
```
GET /api/dashboard/stats/averages
Response: {
  periodo: string,
  ticketMedio: { vendas: number, custos: number },
  maiorVenda: number,
  maiorCusto: number,
  totalVendas: number,
  totalCustos: number,
  melhorDiaSemana: string,
  vendasPorDia: { [dia: string]: number }
}
```

### 8. KPIs e Projeções
```
GET /api/dashboard/stats/kpis
Response: {
  periodo: string,
  kpis: {
    receitas: number,
    custos: number,
    lucro: number,
    margemLucro: number,
    roi: number,
    mediaDiariaReceita: number,
    mediaDiariaCusto: number
  },
  projecao: {
    receitas: number,
    custos: number,
    lucro: number
  },
  diasNoMes: number,
  diaAtual: number
}
```

---

## Requisitos do Dashboard

### Páginas Necessárias

#### 1. **Página de Login** (`/login`)
- Campo de telefone com máscara (11) 99999-9999
- Botão "Entrar"
- Salva telefone no localStorage como `userPhone`
- Redireciona para `/dashboard`
- Design clean com logo Lumiz e cores roxo (#9333ea) e rosa (#ec4899)

#### 2. **Dashboard Principal** (`/dashboard`)
- Header com logo e botão de logout
- **4 cards principais** (receitas, custos, lucro, margem)
- **Gráfico de linha** com timeline do mês (receitas vs custos vs lucro)
- **Gráfico de pizza** com top 5 categorias
- **Lista das últimas 10 transações**
- **Comparativo mês a mês** com setas indicando variação

#### 3. **Página de Relatórios** (`/reports`)
- Seletor de mês/ano
- KPIs detalhados (ROI, ticket médio, projeção)
- Melhor dia da semana para vendas
- Maior venda do mês
- Tabela completa de transações com filtro

#### 4. **Página de Categorias** (`/categories`)
- Top 10 receitas (gráfico de barras horizontal)
- Top 10 custos (gráfico de barras horizontal)
- Tabela com todas as categorias

---

## Componentes Visuais Requeridos

### Cards de KPI
```tsx
// Exemplo visual esperado:
<Card className="border-l-4 border-green-500">
  <div className="text-sm text-gray-600">Receitas</div>
  <div className="text-2xl font-bold text-green-600">R$ 15.000,00</div>
  <div className="text-xs text-green-500">↑ 12.5% vs mês anterior</div>
</Card>
```

### Gráficos
Use a biblioteca **Recharts** para criar:
- LineChart para timeline
- PieChart para categorias
- BarChart para comparativos

### Cores do Sistema
```css
--primary: #9333ea (roxo)
--secondary: #ec4899 (rosa)
--success: #22c55e (verde)
--danger: #ef4444 (vermelho)
--warning: #f59e0b (amarelo)
--background: #f8fafc (cinza claro)
```

---

## Estrutura de Arquivos Esperada

```
src/
├── pages/
│   ├── Login.tsx
│   ├── Dashboard.tsx
│   ├── Reports.tsx
│   └── Categories.tsx
├── components/
│   ├── Layout.tsx (header + sidebar)
│   ├── KPICard.tsx
│   ├── TransactionList.tsx
│   ├── TimelineChart.tsx
│   ├── CategoryPieChart.tsx
│   └── ComparisonCard.tsx
├── lib/
│   └── api.ts (cliente da API)
├── hooks/
│   └── useAuth.ts (gerencia autenticação)
└── types/
    └── index.ts (tipos TypeScript)
```

---

## Código Base para API Client

```typescript
// src/lib/api.ts
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const getHeaders = () => ({
  'Content-Type': 'application/json',
  'x-user-phone': localStorage.getItem('userPhone') || ''
});

export const api = {
  getSummary: () =>
    fetch(`${API_URL}/api/dashboard/summary`, { headers: getHeaders() })
      .then(r => r.json()),

  getTransactions: (limit = 10) =>
    fetch(`${API_URL}/api/dashboard/transactions?limit=${limit}`, { headers: getHeaders() })
      .then(r => r.json()),

  getMonthlyReport: (year?: number, month?: number) => {
    const params = new URLSearchParams();
    if (year) params.set('year', year.toString());
    if (month) params.set('month', month.toString());
    return fetch(`${API_URL}/api/dashboard/monthly-report?${params}`, { headers: getHeaders() })
      .then(r => r.json());
  },

  getTimeline: (year?: number, month?: number) => {
    const params = new URLSearchParams();
    if (year) params.set('year', year.toString());
    if (month) params.set('month', month.toString());
    return fetch(`${API_URL}/api/dashboard/stats/timeline?${params}`, { headers: getHeaders() })
      .then(r => r.json());
  },

  getComparison: () =>
    fetch(`${API_URL}/api/dashboard/stats/comparison`, { headers: getHeaders() })
      .then(r => r.json()),

  getKPIs: (year?: number, month?: number) => {
    const params = new URLSearchParams();
    if (year) params.set('year', year.toString());
    if (month) params.set('month', month.toString());
    return fetch(`${API_URL}/api/dashboard/stats/kpis?${params}`, { headers: getHeaders() })
      .then(r => r.json());
  },

  getAverages: (year?: number, month?: number) => {
    const params = new URLSearchParams();
    if (year) params.set('year', year.toString());
    if (month) params.set('month', month.toString());
    return fetch(`${API_URL}/api/dashboard/stats/averages?${params}`, { headers: getHeaders() })
      .then(r => r.json());
  },

  getCategoriesStats: (year?: number, month?: number) => {
    const params = new URLSearchParams();
    if (year) params.set('year', year.toString());
    if (month) params.set('month', month.toString());
    return fetch(`${API_URL}/api/dashboard/stats/by-category?${params}`, { headers: getHeaders() })
      .then(r => r.json());
  }
};
```

---

## Funcionalidades Obrigatórias

1. ✅ **Login por telefone** - salva no localStorage
2. ✅ **Proteção de rotas** - redireciona para login se não autenticado
3. ✅ **Logout** - limpa localStorage e redireciona
4. ✅ **Loading states** - spinner enquanto carrega dados
5. ✅ **Error handling** - mostra mensagem se API falhar
6. ✅ **Responsivo** - funciona em mobile e desktop
7. ✅ **Formatação brasileira** - R$ 1.500,00 e datas em pt-BR
8. ✅ **Atualização automática** - recarrega dados a cada 30 segundos

---

## Comportamento Esperado

### Na tela de Login:
1. Usuário digita telefone
2. Clica em "Entrar"
3. Sistema salva no localStorage
4. Redireciona para dashboard

### No Dashboard:
1. Verifica se tem telefone no localStorage
2. Se não tiver, redireciona para login
3. Carrega todos os dados da API em paralelo
4. Mostra loading enquanto carrega
5. Renderiza cards, gráficos e listas
6. Atualiza automaticamente a cada 30 segundos

### Nos Relatórios:
1. Permite selecionar mês e ano
2. Recarrega dados quando muda seleção
3. Mostra KPIs detalhados e projeções

---

## Configuração de Ambiente

Criar arquivo `.env`:
```
VITE_API_URL=https://lumiz-backend-production.up.railway.app
```

Para desenvolvimento local:
```
VITE_API_URL=http://localhost:3000
```

---

## Exemplo Visual do Dashboard

```
┌─────────────────────────────────────────────────────┐
│  🟣 Lumiz                              [Logout]     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐│
│  │ Receitas │ │  Custos  │ │  Lucro   │ │ Margem ││
│  │ R$15.000 │ │ R$8.500  │ │ R$6.500  │ │ 43.3%  ││
│  │  ↑12.5%  │ │  ↓5.2%   │ │  ↑18.7%  │ │        ││
│  └──────────┘ └──────────┘ └──────────┘ └────────┘│
│                                                     │
│  ┌─────────────────────────────────────────────────┐│
│  │               Timeline do Mês                   ││
│  │  ─── Receitas  ─── Custos  ─── Lucro          ││
│  │  📈 Gráfico de Linha                           ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  ┌──────────────────┐  ┌───────────────────────────┐│
│  │  Top Categorias  │  │   Últimas Transações    ││
│  │  🥧 Pizza Chart  │  │  💰 Botox R$2800 15/11  ││
│  │                  │  │  💸 Insumos R$3200 14/11││
│  │                  │  │  💰 Prenchim R$1500 14/11││
│  └──────────────────┘  └───────────────────────────┘│
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Instruções Finais para o Lovable

1. **Crie todas as páginas** listadas acima
2. **Instale Recharts** para os gráficos
3. **Use Tailwind CSS** para estilização
4. **Implemente o cliente API** conforme código fornecido
5. **Adicione proteção de rotas** com redirecionamento
6. **Formate valores em pt-BR** (R$ 1.500,00)
7. **Adicione estados de loading** em todas as telas
8. **Trate erros** com mensagens amigáveis
9. **Faça responsivo** para mobile e desktop
10. **Use as cores** roxo e rosa como primárias

**O backend já está 100% pronto. Só precisa criar o frontend que consome esses endpoints.**

---

Agora crie o dashboard completo seguindo essas especificações!
