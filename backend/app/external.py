"""Leitura do status público da RPE (Site24x7 StatusIQ) via feed RSS.

A API oficial do StatusIQ exige OAuth da conta dona da página; o RSS
público lista cada componente com o status atual, sem autenticação.
"""

import time
import xml.etree.ElementTree as ET

import httpx

RPE_RSS_URL = "https://rpe.site24x7statusiq.com/rss"
CACHE_TTL = 60.0  # segundos — evita marteler o feed a cada refresh

_cache: dict = {"at": 0.0, "data": None}


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
