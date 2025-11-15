# Como Funciona o Dashboard

## Pergunta: "Vai ser número por número?"

**Resposta: SIM, cada usuário acessa seus próprios dados usando o número de telefone!**

---

## Como Funciona na Prática

### 1. **Usuário registra dados pelo WhatsApp**
```
Usuário (5511999999999) manda:
"Botox 2800 paciente Ana"

Bot salva no banco:
- user_id: abc123 (ID do usuário 5511999999999)
- tipo: entrada
- valor: 2800
- categoria: Botox
```

### 2. **Usuário acessa o Dashboard Web**
```
Usuário acessa: https://lumiz-financeiro.lovable.app

Tela de login pede:
"Qual seu número de WhatsApp?"

Usuário digita: (11) 99999-9999
```

### 3. **Dashboard carrega dados do usuário**
```javascript
// Frontend faz requisição:
fetch('/api/dashboard/summary', {
  headers: {
    'x-user-phone': '5511999999999'
  }
})

// Backend retorna:
{
  "receitas": 2800.00,
  "custos": 0,
  "lucro": 2800.00,
  "margemLucro": 100
}
```

---

## Fluxo Completo

```
WHATSAPP                          DASHBOARD WEB
   |                                    |
   |  "Botox 2800"                      |
   |  ------------------>               |
   |                                    |
   |  Bot salva no Supabase             |
   |  com user_id do telefone           |
   |                                    |
   |                                    |
   |                              Login com telefone
   |                              <------------------
   |                                    |
   |                              Dashboard carrega
   |                              dados do user_id
   |                              ------------------>
   |                                    |
   |                              Mostra resumo,
   |                              gráficos, transações
```

---

## Estrutura dos Dados no Supabase

### Tabela `users`
```
id (UUID) | phone         | created_at
----------|---------------|------------
abc123    | 5511999999999 | 2025-11-15
def456    | 5521888888888 | 2025-11-14
```

### Tabela `transactions`
```
id  | user_id | tipo    | valor  | categoria
----|---------|---------|--------|----------
1   | abc123  | entrada | 2800   | Botox
2   | abc123  | saida   | 3200   | Insumos
3   | def456  | entrada | 1500   | Preenchimento
```

### Resultado
- Usuário `5511999999999` vê: Receita R$ 2800, Custo R$ 3200
- Usuário `5521888888888` vê: Receita R$ 1500, Custo R$ 0

**Cada usuário só vê SEUS DADOS!**

---

## Implementação Mínima no Lovable

### 1. Criar arquivo `src/lib/api.ts`

```typescript
const API_URL = 'https://SEU-BACKEND.railway.app';

export async function getDashboardData(phone: string) {
  const response = await fetch(`${API_URL}/api/dashboard/summary`, {
    headers: {
      'x-user-phone': phone.replace(/\D/g, '') // Remove formatação
    }
  });
  return response.json();
}

export async function getTransactions(phone: string) {
  const response = await fetch(`${API_URL}/api/dashboard/transactions?limit=10`, {
    headers: {
      'x-user-phone': phone.replace(/\D/g, '')
    }
  });
  return response.json();
}
```

### 2. Tela de Login

```tsx
// pages/Login.tsx
import { useState } from 'react';

export default function Login() {
  const [phone, setPhone] = useState('');

  const handleLogin = () => {
    // Salva o telefone
    localStorage.setItem('userPhone', phone.replace(/\D/g, ''));
    // Redireciona
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

### 3. Tela de Dashboard

```tsx
// pages/Dashboard.tsx
import { useEffect, useState } from 'react';
import { getDashboardData, getTransactions } from '../lib/api';

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const phone = localStorage.getItem('userPhone');

  useEffect(() => {
    if (!phone) {
      window.location.href = '/login';
      return;
    }

    getDashboardData(phone).then(setSummary);
    getTransactions(phone).then(setTransactions);
  }, []);

  return (
    <div>
      <h1>Meu Dashboard</h1>

      {/* Cards */}
      <div>
        <div>Receitas: R$ {summary?.receitas}</div>
        <div>Custos: R$ {summary?.custos}</div>
        <div>Lucro: R$ {summary?.lucro}</div>
      </div>

      {/* Lista de transações */}
      <div>
        {transactions.map(t => (
          <div key={t.id}>
            {t.emoji} R$ {t.valor} - {t.categoria}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Segurança

**IMPORTANTE:** Essa autenticação é SIMPLES (só pelo telefone).

Para produção real, recomendo:
1. **Código SMS** - Enviar código de verificação
2. **JWT Token** - Gerar token após validação
3. **Expiração** - Token expira após X horas

Mas para MVP/teste, autenticação por telefone funciona!

---

## Resumo

1. ✅ **Sim, é número por número**
2. ✅ Cada usuário vê só seus dados
3. ✅ Login = número do WhatsApp
4. ✅ Backend já está pronto
5. ✅ Só precisa conectar no frontend Lovable

**O backend já está pronto! Só precisa fazer o frontend no Lovable consumir a API.**
