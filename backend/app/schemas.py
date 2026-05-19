from datetime import datetime

from pydantic import BaseModel, ConfigDict


class EndpointCreate(BaseModel):
    name: str
    url: str
    method: str = "GET"
    is_active: bool = True
    auth_username: str | None = None
    auth_password: str | None = None


class EndpointUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    method: str | None = None
    is_active: bool | None = None
    auth_username: str | None = None
    auth_password: str | None = None


class EndpointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    url: str
    method: str
    is_active: bool
    created_at: datetime
    # Usuário aparece (para exibir/editar); a senha nunca é devolvida.
    auth_username: str | None = None
    has_auth: bool = False


class SettingsOut(BaseModel):
    check_interval_minutes: int


class SettingsUpdate(BaseModel):
    check_interval_minutes: int


class CheckResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    endpoint_id: int
    status_code: int | None
    response_time_ms: float | None
    success: bool
    error: str | None
    checked_at: datetime


class EndpointWithLast(EndpointOut):
    last_result: CheckResultOut | None = None
    next_check_at: datetime | None = None
    # Média das consultas anteriores à última (baseline do farol).
    avg_response_time_ms: float | None = None
