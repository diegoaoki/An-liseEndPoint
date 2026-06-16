# Endpoint Monitor

Monitor de tempo de resposta de endpoints.

- **`backend/`** — FastAPI + APScheduler + SQLite. A cada 5 min checa todos os
  endpoints ativos e grava o tempo de resposta.
- **`frontend/`** — Next.js (App Router). Tela de admin para cadastrar endpoints
  e ver o histórico.

Deploy via **Docker Compose** no servidor interno `172.16.10.100`
(API em `:8001`, UI em `:8081`), com **autodeploy** a cada push na `main`.

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

## Deploy (servidor interno `172.16.10.100` via Docker)

Backend e frontend rodam em containers (`docker-compose.yml` na raiz).
O SQLite vive no volume `monitor-data` e sobrevive a rebuilds/deploys.

| Serviço  | Porta host | URL                         |
|----------|------------|-----------------------------|
| API      | `8001`     | `http://172.16.10.100:8001` |
| UI       | `8081`     | `http://172.16.10.100:8081` |

### 1. Primeira subida

```bash
git clone <repo> monitor && cd monitor
cp .env.example .env        # ajuste IP/portas se preciso
docker compose up -d --build
```

### 2. Migrar os dados do Railway (one-off)

Pegue a connection string do Postgres no painel do Railway e rode:

```bash
docker compose run --rm \
  -e SOURCE_DATABASE_URL='postgresql://user:pass@host:5432/railway' \
  backend python -m scripts.migrate_pg_to_sqlite
```

Copia endpoints + settings + histórico para `monitor.db` no volume.
Para migrar só a config (sem histórico), passe `-e INCLUDE_HISTORY=false`.

### 3. Autodeploy via GitHub (self-hosted runner)

O servidor tem IP privado, então o deploy roda num **self-hosted runner**
instalado nele. Configuração única:

1. No GitHub: **Settings → Actions → Runners → New self-hosted runner**
   (Linux). Siga os passos de download/config no servidor.
2. Ao configurar, adicione o label **`monitor`** (o workflow usa
   `runs-on: [self-hosted, monitor]`).
3. Instale como serviço: `sudo ./svc.sh install && sudo ./svc.sh start`.
4. Garanta que o usuário do runner está no grupo `docker`
   (`sudo usermod -aG docker <user>`).

A partir daí, todo push na `main` dispara `.github/workflows/deploy.yml`,
que faz `docker compose up -d --build` no servidor.

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
