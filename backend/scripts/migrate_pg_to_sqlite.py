"""Migra os dados do Postgres do Railway para um arquivo SQLite local.

Migração única (one-off). Copia Settings, Endpoints e, por padrão, o
histórico de checagens (CheckResult). Usa ``session.merge`` para preservar
os IDs e ser idempotente — rodar duas vezes não duplica registros.

Uso (dentro do container backend, com o volume /data montado):

    docker compose run --rm \
      -e SOURCE_DATABASE_URL='postgresql://user:pass@host:5432/railway' \
      backend python -m scripts.migrate_pg_to_sqlite

Variáveis:
    SOURCE_DATABASE_URL  (obrigatória) connection string do Postgres do Railway.
    DEST_SQLITE_PATH     destino (default: /data/monitor.db).
    INCLUDE_HISTORY      "false" para migrar só a config, sem histórico.
"""

import os
import sys

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base


def _normalize(url: str) -> str:
    # Railway às vezes entrega o prefixo legado "postgres://".
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url


def main() -> None:
    src_url = os.getenv("SOURCE_DATABASE_URL")
    if not src_url:
        sys.exit(
            "Defina SOURCE_DATABASE_URL com a connection string do Railway."
        )
    dest_path = os.getenv("DEST_SQLITE_PATH", "/data/monitor.db")
    include_history = os.getenv("INCLUDE_HISTORY", "true").lower() != "false"

    src_engine = create_engine(_normalize(src_url), pool_pre_ping=True)
    dest_engine = create_engine(
        f"sqlite:///{dest_path}", connect_args={"check_same_thread": False}
    )

    # Garante o schema no destino antes de inserir.
    Base.metadata.create_all(bind=dest_engine)

    src = sessionmaker(bind=src_engine)()
    dest = sessionmaker(bind=dest_engine)()

    try:
        n_set = 0
        for row in src.query(models.Setting).all():
            dest.merge(models.Setting(key=row.key, value=row.value))
            n_set += 1

        n_ep = 0
        for ep in src.query(models.Endpoint).all():
            dest.merge(
                models.Endpoint(
                    id=ep.id,
                    name=ep.name,
                    url=ep.url,
                    method=ep.method,
                    auth_username=ep.auth_username,
                    auth_password=ep.auth_password,
                    verify_ssl=ep.verify_ssl,
                    latency_threshold_ms=ep.latency_threshold_ms,
                    token_url=ep.token_url,
                    token_payload=ep.token_payload,
                    token_content_type=ep.token_content_type,
                    token_field=ep.token_field,
                    request_body=ep.request_body,
                    request_content_type=ep.request_content_type,
                    is_active=ep.is_active,
                    created_at=ep.created_at,
                )
            )
            n_ep += 1

        n_res = 0
        if include_history:
            for r in src.query(models.CheckResult).all():
                dest.merge(
                    models.CheckResult(
                        id=r.id,
                        endpoint_id=r.endpoint_id,
                        status_code=r.status_code,
                        response_time_ms=r.response_time_ms,
                        success=r.success,
                        error=r.error,
                        checked_at=r.checked_at,
                    )
                )
                n_res += 1

        dest.commit()
        print(
            f"OK -> {dest_path}: {n_ep} endpoints, {n_set} settings, "
            f"{n_res} resultados."
        )
    finally:
        src.close()
        dest.close()


if __name__ == "__main__":
    main()
