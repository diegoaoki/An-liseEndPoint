from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Endpoint(Base):
    __tablename__ = "endpoints"

    # id sequencial (autoincrement) — é o "ID" que o admin verá.
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    url: Mapped[str] = mapped_column(String(2048))
    method: Mapped[str] = mapped_column(String(10), default="GET")
    # Credenciais opcionais (HTTP Basic Auth) do endpoint monitorado.
    auth_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    auth_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Verificar certificado TLS? Desligue para hosts com cert inválido.
    verify_ssl: Mapped[bool] = mapped_column(Boolean, default=True)
    # Limite de tempo de resposta (ms). Se definido, o farol usa este
    # valor (amarelo acima dele) em vez da média.
    latency_threshold_ms: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    # OAuth2 (opcional): se token_url estiver preenchido, antes de
    # checar o endpoint o backend faz POST no token_url com o
    # token_payload e usa Authorization: Bearer <access_token>.
    token_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    token_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_content_type: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    token_field: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Body que vai no POST/PUT/PATCH (raw). Suporta JSON ou form-urlencoded.
    request_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_content_type: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )

    results: Mapped[list["CheckResult"]] = relationship(
        back_populates="endpoint",
        cascade="all, delete-orphan",
        order_by="CheckResult.checked_at.desc()",
    )

    @property
    def has_auth(self) -> bool:
        return bool(self.auth_username or self.auth_password)

    @property
    def has_token(self) -> bool:
        return bool(self.token_url and self.token_payload)

    @property
    def has_request_body(self) -> bool:
        return bool(self.request_body)


class Setting(Base):
    """Configurações chave/valor (ex.: intervalo de checagem)."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(255))


class CheckResult(Base):
    __tablename__ = "check_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    endpoint_id: Mapped[int] = mapped_column(
        ForeignKey("endpoints.id", ondelete="CASCADE"), index=True
    )
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_time_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )

    endpoint: Mapped["Endpoint"] = relationship(back_populates="results")
