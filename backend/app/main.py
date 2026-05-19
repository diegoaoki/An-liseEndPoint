import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from . import models, schemas
from .database import Base, engine, get_db
from .monitor import check_single, run_checks

CHECK_INTERVAL_MINUTES = int(os.getenv("CHECK_INTERVAL_MINUTES", "5"))

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Cria as tabelas se não existirem (suficiente para o escopo atual).
    Base.metadata.create_all(bind=engine)

    scheduler.add_job(
        run_checks,
        trigger="interval",
        minutes=CHECK_INTERVAL_MINUTES,
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
def health():
    return {"status": "ok", "check_interval_minutes": CHECK_INTERVAL_MINUTES}


# ---------- Endpoints (CRUD) ----------


@app.get("/endpoints", response_model=list[schemas.EndpointWithLast])
def list_endpoints(db: Session = Depends(get_db)):
    endpoints = db.query(models.Endpoint).order_by(models.Endpoint.id).all()
    out: list[schemas.EndpointWithLast] = []
    for ep in endpoints:
        last = (
            db.query(models.CheckResult)
            .filter(models.CheckResult.endpoint_id == ep.id)
            .order_by(models.CheckResult.checked_at.desc())
            .first()
        )
        item = schemas.EndpointWithLast.model_validate(ep)
        item.last_result = (
            schemas.CheckResultOut.model_validate(last) if last else None
        )
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
