"""Leitura de status públicos externos.

- RPE: Site24x7 StatusIQ via RSS público (sem auth).
- Linx (QrLinx): API Azure APIM da página pública; a subscription key
  vem embutida no JS público da própria página — uso read-only, igual
  ao que o navegador faz ao abrir statusqr.linx.com.br.
- SEFAZ NF-e: scrape da página pública de disponibilidade (HTML).
- TecnoSpeed: JSON público consumido pelo dashboard
  monitor.tecnospeed.com.br (NFe, CTe, NFCe por UF).
"""

import asyncio
import re
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
_invoicy_cache: dict = {"at": 0.0, "data": None}
_sefaz_cache: dict = {"at": 0.0, "data": None}
_tecno_cache: dict = {"at": 0.0, "data": None}

# TecnoSpeed: dashboard público com status NFe/CTe/NFCe por UF.
TECNO_URL = "https://monitor.tecnospeed.com.br/monitores"
TECNO_DOCS = ["nfe", "cte", "nfce"]
# Mapeamento de status do worker -> texto. Casa com as classes CSS do
# próprio painel (1=green, 2=yellow, 3=orange, 4=grey, 5=red).
TECNO_STATUS = {
    1: "Normal",
    2: "Lento",
    3: "Muito lento",
    4: "Timeout",
    5: "Erro",
}

# SEFAZ NF-e: scrape da página pública (ASP.NET WebForms).
SEFAZ_URL = (
    "https://www.nfe.fazenda.gov.br/portal/disponibilidade.aspx"
    "?AspxAutoDetectCookieSupport=1"
)
SEFAZ_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "pt-BR,pt;q=0.9",
}
SEFAZ_SERVICES = [
    "Autorização",
    "Retorno Autorização",
    "Inutilização",
    "Consulta Protocolo",
    "Status Serviço",
    "Consulta Cadastro",
    "Recepção Evento",
]
# Pior status entre serviços determina a cor do autorizador.
_SEFAZ_PRIORITY = {"Indisponível": 3, "Alerta": 2, "Operacional": 1}

# Invoicy também é StatusIQ; o RSS está desativado, então usamos o
# mesmo endpoint público que o frontend Angular do StatusIQ consome.
INVOICY_BASE = "https://migrate.site24x7statusiq.com"
INVOICY_ENC = "qKvuIOePXvtI4qyqapqOIxRcyjyiconjqR9XrH4QRgo="
INVOICY_SUMMARY_URL = (
    f"{INVOICY_BASE}/sp/api/public/summary_details/statuspages/{INVOICY_ENC}"
)
INVOICY_GROUP_FILTER = "brasil"  # mostra só componentes do grupo Invoicy Brasil

# Mapa de status numérico do StatusIQ -> texto.
STATUSIQ_STATUS = {
    1: "Operacional",
    2: "Informativo",
    3: "Degradação de performance",
    4: "Em manutenção",
    5: "Interrupção parcial",
    6: "Interrupção total",
}


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


async def fetch_invoicy_status() -> dict:
    """Consome o endpoint público do StatusIQ da Invoicy (filtra grupo Brasil)."""
    now = time.time()
    if (
        _invoicy_cache["data"] is not None
        and (now - _invoicy_cache["at"]) < CACHE_TTL
    ):
        return _invoicy_cache["data"]

    headers = {"Accept": "application/json; version=2.0"}
    async with httpx.AsyncClient(headers=headers) as client:
        resp = await client.get(INVOICY_SUMMARY_URL, timeout=20.0)
        resp.raise_for_status()

    payload = resp.json().get("data") or {}
    groups = payload.get("current_status") or []

    items: list[dict] = []
    for group in groups:
        gname = group.get("componentgroup_display_name", "") or ""
        if INVOICY_GROUP_FILTER not in gname.lower():
            continue
        for c in group.get("componentgroup_components") or []:
            status = STATUSIQ_STATUS.get(
                c.get("component_status"), "Desconhecido"
            )
            items.append(
                {
                    "component": c.get("display_name", "—"),
                    "system": gname,
                    "status": status,
                    "updated_at": c.get("last_polled_time", "") or "",
                }
            )

    data = {"source": "https://status.invoicy.com.br/", "items": items}
    _invoicy_cache["at"] = now
    _invoicy_cache["data"] = data
    return data


def _sefaz_ball_status(cell_html: str) -> str:
    if "bola_verde" in cell_html:
        return "Operacional"
    if "bola_amarela" in cell_html:
        return "Alerta"
    if "bola_vermelha" in cell_html:
        return "Indisponível"
    return ""  # <span></span> = serviço não aplicável


async def fetch_sefaz_status() -> dict:
    """Faz scrape da tabela pública de disponibilidade da SEFAZ NF-e.

    A página é ASP.NET WebForms; cada linha tem o UF e 8 células (7 serviços
    + tempo médio). Status dos serviços é uma imagem (bola verde/amarela/
    vermelha) e Tempo Médio é texto.
    """
    now = time.time()
    if (
        _sefaz_cache["data"] is not None
        and (now - _sefaz_cache["at"]) < CACHE_TTL
    ):
        return _sefaz_cache["data"]

    async with httpx.AsyncClient(
        headers=SEFAZ_HEADERS, follow_redirects=True
    ) as client:
        resp = await client.get(SEFAZ_URL, timeout=20.0)
        resp.raise_for_status()

    html = resp.text
    table_match = re.search(
        r'id="ctl00_ContentPlaceHolder1_gdvDisponibilidade2"[^>]*>(.*?)</table>',
        html,
        re.DOTALL,
    )
    if not table_match:
        raise RuntimeError("Tabela de disponibilidade não encontrada")
    table = table_match.group(1)

    cap = re.search(r"Última Verificação:\s*([^<]+)", html)
    checked_at = cap.group(1).strip() if cap else ""

    items: list[dict] = []
    for row in re.finditer(r"<tr[^>]*>(.*?)</tr>", table, re.DOTALL):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row.group(1), re.DOTALL)
        if len(cells) < 9:
            continue  # header (<th>) ou linha incompleta
        uf = re.sub(r"<[^>]+>", "", cells[0]).strip()
        if not uf:
            continue
        # 5 serviços, tempo médio (texto), 2 serviços
        svc_cells = cells[1:6] + cells[7:9]
        statuses = [_sefaz_ball_status(c) for c in svc_cells]
        services = [
            {"name": name, "status": st or "N/A"}
            for name, st in zip(SEFAZ_SERVICES, statuses)
        ]
        valid = [s for s in statuses if s]
        worst = (
            max(valid, key=lambda s: _SEFAZ_PRIORITY.get(s, 0))
            if valid
            else "Sem dados"
        )
        tempo = re.sub(r"<[^>]+>", "", cells[6]).strip() or "-"
        items.append(
            {
                "component": uf,
                "status": worst,
                "system": "",
                "updated_at": checked_at,
                "tempo_medio": tempo,
                "services": services,
            }
        )

    data = {"source": SEFAZ_URL, "checked_at": checked_at, "items": items}
    _sefaz_cache["at"] = now
    _sefaz_cache["data"] = data
    return data


async def fetch_tecnospeed_status() -> dict:
    """Consome o endpoint público do dashboard TecnoSpeed.

    Faz 1 GET por tipo de documento (nfe/cte/nfce) em paralelo. Cada
    resposta é uma lista de workers; do id_worker (`sefaz_{doc}_envio_{uf}`)
    extraímos a UF e mapeamos o código numérico para um texto.
    """
    now = time.time()
    if (
        _tecno_cache["data"] is not None
        and (now - _tecno_cache["at"]) < CACHE_TTL
    ):
        return _tecno_cache["data"]

    async with httpx.AsyncClient() as client:

        async def fetch_doc(doc: str) -> tuple[str, list[dict]]:
            resp = await client.get(
                TECNO_URL,
                params={
                    "stateStatus": "true",
                    "doc": doc,
                    "worker_id": f"sefaz_{doc}_envio_pr",
                },
                timeout=20.0,
            )
            resp.raise_for_status()
            return doc, resp.json()

        results = await asyncio.gather(*(fetch_doc(d) for d in TECNO_DOCS))

    doc_label = {"nfe": "NFe", "cte": "CTe", "nfce": "NFCe"}
    items: list[dict] = []
    for doc, rows in results:
        for row in rows:
            wid = row.get("id_worker") or ""
            uf = (wid.rsplit("_", 1)[-1] if wid else "").upper()
            if not uf:
                continue
            try:
                code = int(float(row.get("status") or 0))
            except (TypeError, ValueError):
                code = 0
            items.append(
                {
                    "component": f"{doc_label[doc]} · {uf}",
                    "uf": uf,
                    "system": doc_label[doc],
                    "status": TECNO_STATUS.get(code, "Sem dados"),
                    "updated_at": "",
                }
            )

    # ordena por doc (NFe, CTe, NFCe) e depois UF, pra render previsível
    order = {"NFe": 0, "CTe": 1, "NFCe": 2}
    items.sort(key=lambda i: (order.get(i["system"], 99), i["uf"]))

    data = {"source": "https://monitor.tecnospeed.com.br/", "items": items}
    _tecno_cache["at"] = now
    _tecno_cache["data"] = data
    return data
