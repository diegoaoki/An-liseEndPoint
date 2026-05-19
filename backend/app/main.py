import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from . import models, schemas
from .database import Base, SessionLocal, engine, get_db
from .external import fetch_linx_status, fetch_rpe_status
from .monitor import check_single, run_checks

DEFAULT_INTERVAL_MINUTES = int(os.getenv("CHECK_INTERVAL_MINUTES", "5"))
INTERVAL_KEY = "check_interval_minutes"
MIN_INTERVAL = 1
MAX_INTERVAL = 1440  # 24h

scheduler = AsyncIOScheduler()


def get_interval(db: Session) -> int:
    """Lê o intervalo do banco; cria com o default na primeira vez."""
    row = db.get(models.Setting, INTERVAL_KEY)
    if row is None:
        row = models.Setting(key=INTERVAL_KEY, value=str(DEFAULT_INTERVAL_MINUTES))
        db.add(row)
        db.commit()
        return DEFAULT_INTERVAL_MINUTES
    try:
        return int(row.value)
    except ValueError:
        return DEFAULT_INTERVAL_MINUTES


def set_interval(db: Session, minutes: int) -> None:
    row = db.get(models.Setting, INTERVAL_KEY)
    if row is None:
        db.add(models.Setting(key=INTERVAL_KEY, value=str(minutes)))
    else:
        row.value = str(minutes)
    db.commit()
    # Aplica imediatamente no scheduler já rodando.
    scheduler.reschedule_job("run_checks", trigger="interval", minutes=minutes)


def run_migrations() -> None:
    """Adiciona colunas novas a tabelas já existentes (create_all não faz isso).

    Idempotente: só roda o ALTER quando a coluna não existe.
    """
    insp = inspect(engine)
    existing = {c["name"] for c in insp.get_columns("endpoints")}
    new_columns = {
        "auth_username": "VARCHAR(255)",
        "auth_password": "VARCHAR(255)",
    }
    with engine.begin() as conn:
        for col, col_type in new_columns.items():
            if col not in existing:
                conn.execute(
                    text(f"ALTER TABLE endpoints ADD COLUMN {col} {col_type}")
                )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Cria as tabelas se não existirem (suficiente para o escopo atual).
    Base.metadata.create_all(bind=engine)
    run_migrations()

    db = SessionLocal()
    try:
        interval = get_interval(db)
    finally:
        db.close()

    scheduler.add_job(
        run_checks,
        trigger="interval",
        minutes=interval,
        id="run_checks",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Endpoint Monitor", version="0.1.0", lifespan=lifespan)

# Sem auth por enquanto; CORS aberto (ajustável via env CORS_ORIGINS).
cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health(db: Session = Depends(get_db)):
    return {"status": "ok", "check_interval_minutes": get_interval(db)}


@app.get("/settings", response_model=schemas.SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    return schemas.SettingsOut(check_interval_minutes=get_interval(db))


@app.put("/settings", response_model=schemas.SettingsOut)
def update_settings(
    payload: schemas.SettingsUpdate, db: Session = Depends(get_db)
):
    m = payload.check_interval_minutes
    if not (MIN_INTERVAL <= m <= MAX_INTERVAL):
        raise HTTPException(
            status_code=422,
            detail=f"Intervalo deve estar entre {MIN_INTERVAL} e {MAX_INTERVAL} minutos",
        )
    set_interval(db, m)
    return schemas.SettingsOut(check_interval_minutes=m)


@app.post("/check-all")
async def check_all():
    """Dispara uma checagem imediata de todos os endpoints ativos."""
    await run_checks()
    return {"status": "ok"}


@app.get("/external/rpe-status")
async def rpe_status():
    """Status público dos componentes da RPE (via RSS do StatusIQ)."""
    try:
        return await fetch_rpe_status()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"Falha ao ler status.rpe.tech: {exc}",
        )


@app.get("/external/linx-status")
async def linx_status():
    """Status público dos PSPs da QrLinx (statusqr.linx.com.br)."""
    try:
        return await fetch_linx_status()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"Falha ao ler statusqr.linx.com.br: {exc}",
        )


# ---------- Endpoints (CRUD) ----------


@app.get("/endpoints", response_model=list[schemas.EndpointWithLast])
def list_endpoints(db: Session = Depends(get_db)):
    endpoints = db.query(models.Endpoint).order_by(models.Endpoint.id).all()

    # Próxima execução do job recorrente (mesma para todos os ativos,
    # pois a checagem é um único job em intervalo).
    job = scheduler.get_job("run_checks")
    next_run = job.next_run_time if job else None

    # Quantas consultas anteriores entram na média (baseline do farol).
    avg_window = 20

    out: list[schemas.EndpointWithLast] = []
    for ep in endpoints:
        recent = (
            db.query(models.CheckResult)
            .filter(models.CheckResult.endpoint_id == ep.id)
            .order_by(models.CheckResult.checked_at.desc())
            .limit(avg_window + 1)
            .all()
        )
        last = recent[0] if recent else None

        # Média das consultas ANTERIORES à última (baseline de comparação).
        baseline = [
            r.response_time_ms
            for r in recent[1:]
            if r.response_time_ms is not None
        ]
        avg = round(sum(baseline) / len(baseline), 2) if baseline else None

        item = schemas.EndpointWithLast.model_validate(ep)
        item.last_result = (
            schemas.CheckResultOut.model_validate(last) if last else None
        )
        item.avg_response_time_ms = avg
        # Endpoint pausado não entra na checagem -> sem próxima.
        item.next_check_at = next_run if ep.is_active else None
        out.append(item)
    return out


@app.post("/endpoints", response_model=schemas.EndpointOut, status_code=201)
def create_endpoint(payload: schemas.EndpointCreate, db: Session = Depends(get_db)):
    ep = models.Endpoint(**payload.model_dump())
    db.add(ep)
    db.commit()
    db.refresh(ep)
    return ep


@app.get("/endpoints/{endpoint_id}", response_model=schemas.EndpointOut)
def get_endpoint(endpoint_id: int, db: Session = Depends(get_db)):
    ep = db.get(models.Endpoint, endpoint_id)
    if ep is None:
        raise HTTPException(status_code=404, detail="Endpoint não encontrado")
    return ep


@app.patch("/endpoints/{endpoint_id}", response_model=schemas.EndpointOut)
def update_endpoint(
    endpoint_id: int,
    payload: schemas.EndpointUpdate,
    db: Session = Depends(get_db),
):
    ep = db.get(models.Endpoint, endpoint_id)
    if ep is None:
        raise HTTPException(status_code=404, detail="Endpoint não encontrado")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(ep, field, value)
    db.commit()
    db.refresh(ep)
    return ep


@app.delete("/endpoints/{endpoint_id}", status_code=204)
def delete_endpoint(endpoint_id: int, db: Session = Depends(get_db)):
    ep = db.get(models.Endpoint, endpoint_id)
    if ep is None:
        raise HTTPException(status_code=404, detail="Endpoint não encontrado")
    db.delete(ep)
    db.commit()


# ---------- Resultados ----------


@app.get(
    "/endpoints/{endpoint_id}/results",
    response_model=list[schemas.CheckResultOut],
)
def list_results(
    endpoint_id: int,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    if db.get(models.Endpoint, endpoint_id) is None:
        raise HTTPException(status_code=404, detail="Endpoint não encontrado")
    limit = max(1, min(limit, 1000))
    return (
        db.query(models.CheckResult)
        .filter(models.CheckResult.endpoint_id == endpoint_id)
        .order_by(models.CheckResult.checked_at.desc())
        .limit(limit)
        .all()
    )


@app.post(
    "/endpoints/{endpoint_id}/check",
    response_model=schemas.CheckResultOut,
)
async def check_now(endpoint_id: int):
    result = await check_single(endpoint_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Endpoint não encontrado")
    return result
