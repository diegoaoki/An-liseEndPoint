from datetime import datetime

from pydantic import BaseModel, ConfigDict


class EndpointCreate(BaseModel):
    name: str
    url: str
    method: str = "GET"
    is_active: bool = True


class EndpointUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    method: str | None = None
    is_active: bool | None = None


class EndpointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    url: str
    method: str
    is_active: bool
    created_at: datetime


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
