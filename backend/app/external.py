"""Leitura de status públicos externos.

- RPE: Site24x7 StatusIQ via RSS público (sem auth).
- Linx (QrLinx): API Azure APIM da página pública; a subscription key
  vem embutida no JS público da própria página — uso read-only, igual
  ao que o navegador faz ao abrir statusqr.linx.com.br.
"""

import time
import xml.etree.ElementTree as ET

import httpx

RPE_RSS_URL = "https://rpe.site24x7statusiq.com/rss"
CACHE_TTL = 60.0  # segundos — evita marteler o feed a cada refresh

LINX_BASE = "https://api.linxpayhub.com.br/wallet-qrlinx-monitoria"
LINX_HEADERS = {
    "Ocp-Apim-Subscription-Key": "db57e1e5f090424398b1389b21c38175",
    "Apim-Company-Channel": "StatusPageQrLinx",
    "Apim-Company-Target": "linx-prd",
    "Content-Type": "application/json",
}

_cache: dict = {"at": 0.0, "data": None}
_linx_cache: dict = {"at": 0.0, "data": None}


async def fetch_rpe_status() -> dict:
    now = time.time()
    if _cache["data"] is not None and (now - _cache["at"]) < CACHE_TTL:
        return _cache["data"]

    async with httpx.AsyncClient() as client:
        resp = await client.get(RPE_RSS_URL, timeout=20.0)
        resp.raise_for_status()

    root = ET.fromstring(resp.content)
    items = []
    for item in root.iterfind(".//item"):
        title = (item.findtext("title") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        # Título no formato "Componente - Status".
        if " - " in title:
            name, status = title.rsplit(" - ", 1)
        else:
            name, status = title, ""
        items.append(
            {
                "component": name.strip(),
                "status": status.strip(),
                "updated_at": pub,
            }
        )

    data = {"source": RPE_RSS_URL, "items": items}
    _cache["at"] = now
    _cache["data"] = data
    return data


async def fetch_linx_status() -> dict:
    now = time.time()
    if _linx_cache["data"] is not None and (now - _linx_cache["at"]) < CACHE_TTL:
        return _linx_cache["data"]

    async with httpx.AsyncClient(headers=LINX_HEADERS) as client:
        sys_resp = await client.get(f"{LINX_BASE}/v1/system/psp", timeout=20.0)
        sys_resp.raise_for_status()
        psp_resp = await client.get(f"{LINX_BASE}/v1/psp", timeout=20.0)
        psp_resp.raise_for_status()

    systems = {
        s.get("systemId"): s.get("name", "")
        for s in (sys_resp.json().get("data") or [])
    }

    items = []
    for p in psp_resp.json().get("data") or []:
        active = p.get("isActive", True)
        warning = p.get("warning", False)
        if not active:
            status = "Inativo"
        elif warning:
            status = "Alerta"
        else:
            status = "Operacional"
        items.append(
            {
                "component": p.get("name", "—"),
                "system": systems.get(p.get("systemId"), ""),
                "status": status,
                "updated_at": "",
            }
        )

    data = {"source": "https://statusqr.linx.com.br", "items": items}
    _linx_cache["at"] = now
    _linx_cache["data"] = data
    return data
