# Endpoint Monitor

Monitor de tempo de resposta de endpoints.

- **`backend/`** — FastAPI + APScheduler + PostgreSQL. A cada 5 min checa todos os
  endpoints ativos e grava o tempo de resposta. Deploy no **Railway**.
- **`frontend/`** — Next.js (App Router). Tela de admin para cadastrar endpoints
  e ver o histórico. Deploy na **Vercel**.

> Sem autenticação por enquanto (uso pessoal). Se a API ficar pública, adicione
> uma API key antes — ver "Próximos passos".

---

## Como funciona

1. Você cadastra um endpoint na tela de admin (nome, URL, método).
2. Cada endpoint recebe um **ID sequencial**.
3. O scheduler do backend roda de 5 em 5 min e faz um request em cada endpoint
   ativo, registrando: status HTTP, tempo de resposta (ms), sucesso/erro.
4. A tela de admin mostra o último status e o histórico de cada endpoint.

Intervalo configurável via env `CHECK_INTERVAL_MINUTES` (padrão: 5).

---

## Rodar localmente

> Esta máquina não tem Python nem Node instalados. Instale antes:
> [Python 3.11+](https://www.python.org/downloads/) e
> [Node.js 20+](https://nodejs.org/).

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# Sem DATABASE_URL ele usa SQLite (local.db) automaticamente.
uvicorn app.main:app --reload --port 8000
```

API em `http://localhost:8000` — docs interativas em `http://localhost:8000/docs`.

### Frontend

```powershell
cd frontend
npm install
copy .env.example .env.local   # ajuste NEXT_PUBLIC_API_URL se precisar
npm run dev
```

App em `http://localhost:3000`.

---

## Deploy

### Backend → Railway

1. Crie um projeto no Railway a partir deste repositório.
2. Em **Settings → Root Directory**, defina `backend`.
3. Adicione o plugin **PostgreSQL** (Railway injeta `DATABASE_URL`
   automaticamente — o código já normaliza o prefixo `postgres://`).
4. Variáveis recomendadas:
   - `CHECK_INTERVAL_MINUTES=5`
   - `CORS_ORIGINS=https://SEU-APP.vercel.app` (ou `*` enquanto testa)
5. O start command já vem do `railway.json` / `Procfile`.
6. Após o deploy, copie a URL pública (ex.: `https://xxx.up.railway.app`).

### Frontend → Vercel

1. Importe o repositório na Vercel.
2. Em **Root Directory**, defina `frontend`.
3. Variável de ambiente:
   - `NEXT_PUBLIC_API_URL=https://xxx.up.railway.app` (URL do Railway, sem `/` no fim)
4. Deploy. Atualize `CORS_ORIGINS` no Railway com a URL final da Vercel.

---

## API (resumo)

| Método | Rota                          | Descrição                          |
|--------|-------------------------------|------------------------------------|
| GET    | `/health`                     | Healthcheck                        |
| GET    | `/endpoints`                  | Lista endpoints + último resultado |
| POST   | `/endpoints`                  | Cria endpoint                      |
| PATCH  | `/endpoints/{id}`             | Atualiza (ex.: pausar)             |
| DELETE | `/endpoints/{id}`             | Remove (apaga histórico)           |
| GET    | `/endpoints/{id}/results`     | Histórico de checagens             |
| POST   | `/endpoints/{id}/check`       | Checagem manual imediata           |

---

## Próximos passos sugeridos

- **Auth**: API key simples via header (env var) antes de expor publicamente.
- **Retenção**: job para apagar resultados antigos (> N dias).
- **Alertas**: notificar quando um endpoint falhar X vezes seguidas.
- **Gráficos**: visualização da latência ao longo do tempo no frontend.
