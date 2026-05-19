"""Lógica de checagem dos endpoints e o job recorrente."""

import asyncio
import time

import httpx

from . import models
from .database import SessionLocal

REQUEST_TIMEOUT = 30.0


async def check_endpoint(endpoint: models.Endpoint) -> models.CheckResult:
    """Faz um request no endpoint e devolve o resultado (sem persistir).

    Cria um client por checagem porque o `verify` (validar TLS) é
    configurado por endpoint, não por requisição.
    """
    auth = (
        (endpoint.auth_username or "", endpoint.auth_password or "")
        if (endpoint.auth_username or endpoint.auth_password)
        else None
    )
    verify = endpoint.verify_ssl if endpoint.verify_ssl is not None else True
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(verify=verify) as client:
            resp = await client.request(
                endpoint.method.upper(),
                endpoint.url,
                timeout=REQUEST_TIMEOUT,
                follow_redirects=True,
                auth=auth,
            )
        elapsed_ms = (time.perf_counter() - start) * 1000
        return models.CheckResult(
            endpoint_id=endpoint.id,
            status_code=resp.status_code,
            response_time_ms=round(elapsed_ms, 2),
            success=200 <= resp.status_code < 400,
            error=None,
        )
    except Exception as exc:  # noqa: BLE001 - queremos registrar qualquer falha
        elapsed_ms = (time.perf_counter() - start) * 1000
        return models.CheckResult(
            endpoint_id=endpoint.id,
            status_code=None,
            response_time_ms=round(elapsed_ms, 2),
            success=False,
            error=f"{type(exc).__name__}: {exc}"[:500],
        )


async def run_checks() -> None:
    """Job chamado pelo scheduler: checa todos os endpoints ativos."""
    db = SessionLocal()
    try:
        endpoints = (
            db.query(models.Endpoint)
            .filter(models.Endpoint.is_active.is_(True))
            .all()
        )
        if not endpoints:
            return

        results = await asyncio.gather(
            *(check_endpoint(e) for e in endpoints)
        )

        db.add_all(results)
        db.commit()
    finally:
        db.close()


async def check_single(endpoint_id: int) -> models.CheckResult | None:
    """Checagem manual de um endpoint específico (botão 'checar agora')."""
    db = SessionLocal()
    try:
        endpoint = db.get(models.Endpoint, endpoint_id)
        if endpoint is None:
            return None
        result = await check_endpoint(endpoint)
        db.add(result)
        db.commit()
        db.refresh(result)
        return result
    finally:
        db.close()
