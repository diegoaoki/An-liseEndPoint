"""Lógica de checagem dos endpoints e o job recorrente."""

import asyncio
import time
from urllib.parse import urlparse

import httpx

from . import models
from .database import SessionLocal


def _parse_host_port(url: str) -> tuple[str, int]:
    """Extrai host e porta de URL/host:porta para o check TCP."""
    parsed = urlparse(url if "://" in url else f"tcp://{url}")
    host = parsed.hostname
    if not host:
        raise ValueError(f"URL sem host: {url!r}")
    port = parsed.port
    if port is None:
        if parsed.scheme == "https":
            port = 443
        elif parsed.scheme == "http":
            port = 80
    if port is None:
        raise ValueError(f"URL sem porta: {url!r}")
    return host, port


async def _tcp_check(endpoint: models.Endpoint) -> tuple[bool, float, str | None]:
    """Tenta abrir socket TCP. Devolve (sucesso, ms, erro)."""
    start = time.perf_counter()
    try:
        host, port = _parse_host_port(endpoint.url)
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=REQUEST_TIMEOUT,
        )
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass
        return True, elapsed_ms, None
    except Exception as exc:  # noqa: BLE001
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        return False, elapsed_ms, f"{type(exc).__name__}: {exc}"[:500]

REQUEST_TIMEOUT = 30.0
TOKEN_TIMEOUT = 20.0
TOKEN_DEFAULT_TTL = 300.0  # 5 min se a resposta não trouxer expires_in
TOKEN_RENEW_SAFETY = 60.0  # renova com 60s de folga

# Cache em memória: endpoint_id -> (access_token, exp_epoch)
_token_cache: dict[int, tuple[str, float]] = {}


def invalidate_token(endpoint_id: int) -> None:
    _token_cache.pop(endpoint_id, None)


async def _fetch_token(endpoint: models.Endpoint) -> str:
    """Obtém o access_token (com cache). Lança em caso de falha."""
    now = time.time()
    cached = _token_cache.get(endpoint.id)
    if cached and cached[1] > now:
        return cached[0]

    content_type = (
        endpoint.token_content_type or "application/x-www-form-urlencoded"
    )
    field = endpoint.token_field or "access_token"
    verify = endpoint.verify_ssl if endpoint.verify_ssl is not None else True

    async with httpx.AsyncClient(verify=verify) as client:
        resp = await client.post(
            endpoint.token_url,
            content=endpoint.token_payload or "",
            headers={"Content-Type": content_type},
            timeout=TOKEN_TIMEOUT,
            follow_redirects=True,
        )
    resp.raise_for_status()
    data = resp.json()
    token = data.get(field)
    if not token:
        raise RuntimeError(
            f"Token endpoint não retornou campo '{field}' (chaves: {list(data)[:5]})"
        )
    expires_in = data.get("expires_in")
    ttl = (
        float(expires_in) - TOKEN_RENEW_SAFETY
        if isinstance(expires_in, (int, float))
        else TOKEN_DEFAULT_TTL
    )
    if ttl < 30:
        ttl = 30  # mínimo
    _token_cache[endpoint.id] = (token, now + ttl)
    return token


async def check_endpoint(endpoint: models.Endpoint) -> models.CheckResult:
    """Faz um request no endpoint e devolve o resultado (sem persistir)."""
    if (endpoint.method or "").upper() == "TCP":
        success, elapsed_ms, error = await _tcp_check(endpoint)
        return models.CheckResult(
            endpoint_id=endpoint.id,
            status_code=None,
            response_time_ms=elapsed_ms,
            success=success,
            error=error,
        )

    verify = endpoint.verify_ssl if endpoint.verify_ssl is not None else True

    start = time.perf_counter()
    try:
        headers: dict[str, str] = {}
        auth = None
        if endpoint.token_url and endpoint.token_payload:
            token = await _fetch_token(endpoint)
            headers["Authorization"] = f"Bearer {token}"
        elif endpoint.auth_username or endpoint.auth_password:
            auth = (
                endpoint.auth_username or "",
                endpoint.auth_password or "",
            )

        body = endpoint.request_body or None
        if body:
            headers["Content-Type"] = (
                endpoint.request_content_type or "application/json"
            )

        async with httpx.AsyncClient(verify=verify) as client:
            resp = await client.request(
                endpoint.method.upper(),
                endpoint.url,
                timeout=REQUEST_TIMEOUT,
                follow_redirects=True,
                auth=auth,
                headers=headers or None,
                content=body,
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
        # Token inválido pode ter sido cacheado expirado pelo servidor; limpa.
        invalidate_token(endpoint.id)
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


PREVIEW_MAX_BODY = 64 * 1024  # 64 KB
PREVIEW_TIMEOUT = 30.0


async def preview_endpoint(endpoint_id: int) -> dict | None:
    """Faz uma requisição AO VIVO e devolve o corpo da resposta (sem persistir)."""
    db = SessionLocal()
    try:
        ep = db.get(models.Endpoint, endpoint_id)
        if ep is None:
            return None
        verify = ep.verify_ssl if ep.verify_ssl is not None else True
    finally:
        db.close()

    if (ep.method or "").upper() == "TCP":
        success, elapsed_ms, error = await _tcp_check(ep)
        return {
            "status_code": None,
            "response_time_ms": elapsed_ms,
            "content_type": "tcp/check",
            "body": "(TCP connect OK)" if success else None,
            "truncated": False,
            "success": success,
            "error": error,
        }

    start = time.perf_counter()
    try:
        headers: dict[str, str] = {}
        auth = None
        if ep.token_url and ep.token_payload:
            token = await _fetch_token(ep)
            headers["Authorization"] = f"Bearer {token}"
        elif ep.auth_username or ep.auth_password:
            auth = (ep.auth_username or "", ep.auth_password or "")

        body = ep.request_body or None
        if body:
            headers["Content-Type"] = (
                ep.request_content_type or "application/json"
            )

        async with httpx.AsyncClient(verify=verify) as client:
            resp = await client.request(
                ep.method.upper(),
                ep.url,
                timeout=PREVIEW_TIMEOUT,
                follow_redirects=True,
                auth=auth,
                headers=headers or None,
                content=body,
            )
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        text = resp.text or ""
        truncated = len(text) > PREVIEW_MAX_BODY
        if truncated:
            text = text[:PREVIEW_MAX_BODY]
        return {
            "status_code": resp.status_code,
            "response_time_ms": elapsed_ms,
            "content_type": resp.headers.get("content-type"),
            "body": text,
            "truncated": truncated,
            "success": 200 <= resp.status_code < 400,
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001
        invalidate_token(ep.id)
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        return {
            "status_code": None,
            "response_time_ms": elapsed_ms,
            "content_type": None,
            "body": None,
            "truncated": False,
            "success": False,
            "error": f"{type(exc).__name__}: {exc}"[:500],
        }


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
