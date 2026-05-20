"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

const METHODS = ["GET", "POST", "HEAD", "PUT", "DELETE"];

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

function fmtMs(ms) {
  if (ms == null) return "—";
  return `${ms.toFixed(0)} ms`;
}

function fmtNext(iso, isActive) {
  if (!isActive) return "—";
  if (!iso) return "—";
  const d = new Date(iso);
  const diffS = Math.round((d.getTime() - Date.now()) / 1000);
  let rel;
  if (diffS <= 0) rel = "agora";
  else if (diffS < 60) rel = `em ${diffS}s`;
  else rel = `em ${Math.round(diffS / 60)} min`;
  return `${d.toLocaleTimeString("pt-BR")} (${rel})`;
}

function ResultBadge({ result }) {
  if (!result) return <span className="badge idle">sem dados</span>;
  if (result.success) {
    return <span className="badge ok">{result.status_code} OK</span>;
  }
  return (
    <span className="badge fail">
      {result.status_code ? `HTTP ${result.status_code}` : "falha"}
    </span>
  );
}

// Margens sobre a média (absorve o jitter normal de rede):
const GREEN_THRESHOLD = 1.2; // até +20% ainda é verde
const SLOW_THRESHOLD = 1.5; // acima de +50% = "muito lento" (ainda amarelo)

// Decide a cor do farol comparando a última consulta com a média anterior.
// Regra: vermelho APENAS se a API estiver fora; qualquer lentidão é amarelo.
function farolStatus(ep) {
  const last = ep.last_result;
  if (!last) return { color: "gray", texto: "Sem dados" };
  if (!last.success) return { color: "red", texto: "Fora do ar" };
  const lastMs = last.response_time_ms;

  // Limite fixo definido para este endpoint: ignora a média.
  const limit = ep.latency_threshold_ms;
  if (limit != null) {
    if (lastMs == null) return { color: "blue", texto: "Sem leitura ainda" };
    if (lastMs <= limit) {
      return { color: "green", texto: `Dentro do limite (${limit} ms)` };
    }
    return { color: "yellow", texto: `Acima do limite (${limit} ms)` };
  }

  const avg = ep.avg_response_time_ms;
  if (avg == null || lastMs == null) {
    return { color: "blue", texto: "Sem base de comparação ainda" };
  }
  if (lastMs <= avg * GREEN_THRESHOLD) {
    return { color: "green", texto: "Dentro da média" };
  }
  const pct = Math.round((lastMs / avg - 1) * 100);
  if (lastMs <= avg * SLOW_THRESHOLD) {
    return { color: "yellow", texto: `Levemente lento (+${pct}%)` };
  }
  return { color: "yellow", texto: `Muito lento (+${pct}% da média)` };
}

function Farol({ ep, domId }) {
  const { color, texto } = farolStatus(ep);
  const last = ep.last_result;
  const avg = ep.avg_response_time_ms;
  // Card agressivo quando a última consulta falhou (endpoint fora do ar).
  const isDown = last && !last.success;
  return (
    <div
      id={domId}
      className={isDown ? "dash-card dash-card-down" : "dash-card"}
    >
      {isDown && <div className="down-banner">⚠ FORA DO AR</div>}
      <div className="dash-head">
        <span className={`farol farol-${color}`} title={texto} />
        <div>
          <strong>{ep.name}</strong>
          {ep.has_auth && (
            <span style={{ marginLeft: 6 }} title="Basic Auth">
              🔒
            </span>
          )}
          {!ep.is_active && (
            <span className="badge idle" style={{ marginLeft: 8 }}>
              pausado
            </span>
          )}
          <div className="muted" style={{ fontSize: "0.74rem" }}>
            #{ep.id} · {ep.method} {ep.url}
          </div>
        </div>
      </div>
      <div className="dash-label">
        <span>
          Média: <strong>{fmtMs(avg)}</strong>
        </span>
        <span>
          Última: <strong>{fmtMs(last?.response_time_ms)}</strong>
        </span>
      </div>
      <div className="muted" style={{ fontSize: "0.74rem" }}>
        {texto} · checado {fmtTime(last?.checked_at)}
      </div>
    </div>
  );
}

function tryPrettyJson(text, contentType) {
  // Se o tipo for JSON (ou começar com {/[), tenta formatar.
  const ct = (contentType || "").toLowerCase();
  const looksJson = ct.includes("json") || /^\s*[\[{]/.test(text || "");
  if (!looksJson) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function LogTable({ rows }) {
  const [opened, setOpened] = useState({}); // { [rowId]: {loading, data, error} }

  async function loadPreview(row) {
    setOpened((s) => ({ ...s, [row.id]: { loading: true } }));
    try {
      const data = await api.previewEndpoint(row.endpoint_id);
      setOpened((s) => ({ ...s, [row.id]: { loading: false, data } }));
    } catch (e) {
      setOpened((s) => ({
        ...s,
        [row.id]: { loading: false, error: e.message },
      }));
    }
  }

  function toggle(row) {
    setOpened((s) => {
      if (s[row.id]) {
        const ns = { ...s };
        delete ns[row.id];
        return ns;
      }
      return s;
    });
    if (!opened[row.id]) loadPreview(row);
  }

  if (!rows || rows.length === 0)
    return <p className="muted">Sem registros ainda.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Quando</th>
          <th>Endpoint</th>
          <th>Resultado</th>
          <th>Tempo</th>
          <th>Erro</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const o = opened[r.id];
          return (
            <Fragment key={r.id}>
              <tr>
                <td className="muted">{fmtTime(r.checked_at)}</td>
                <td>
                  <strong>{r.endpoint_name}</strong>{" "}
                  <span className="muted">#{r.endpoint_id}</span>
                </td>
                <td>
                  {r.success ? (
                    <span className="badge ok">{r.status_code} OK</span>
                  ) : (
                    <span className="badge fail">
                      {r.status_code ? `HTTP ${r.status_code}` : "falha"}
                    </span>
                  )}
                </td>
                <td>{fmtMs(r.response_time_ms)}</td>
                <td className="muted" style={{ fontSize: "0.78rem" }}>
                  {r.error || "—"}
                </td>
                <td>
                  <button className="ghost" onClick={() => toggle(r)}>
                    {o ? "Ocultar" : "Ver retorno"}
                  </button>
                </td>
              </tr>
              {o && (
                <tr className="history-row">
                  <td colSpan={6}>
                    {o.loading && (
                      <span className="muted">Carregando retorno ao vivo…</span>
                    )}
                    {o.error && (
                      <div className="error-msg">⚠ {o.error}</div>
                    )}
                    {o.data && (
                      <div>
                        <div
                          className="muted"
                          style={{ fontSize: "0.78rem", marginBottom: 6 }}
                        >
                          <strong>Live</strong> · status{" "}
                          {o.data.status_code ?? "—"} ·{" "}
                          {fmtMs(o.data.response_time_ms)} ·{" "}
                          {o.data.content_type || "—"}
                          {o.data.truncated && " · (truncado em 64 KB)"}
                        </div>
                        {o.data.error ? (
                          <pre className="preview-pre fail-pre">
                            {o.data.error}
                          </pre>
                        ) : (
                          <pre className="preview-pre">
                            {tryPrettyJson(o.data.body, o.data.content_type) ||
                              "(corpo vazio)"}
                          </pre>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function Dashboard({ endpoints, loading }) {
  if (loading) return <p className="muted">Carregando…</p>;
  if (endpoints.length === 0)
    return <p className="muted">Nenhum endpoint cadastrado ainda.</p>;
  return (
    <div className="dash-grid">
      {endpoints.map((ep) => (
        <Farol key={ep.id} ep={ep} domId={`api-card-${ep.id}`} />
      ))}
    </div>
  );
}

// Componentes da RPE sempre exibidos no board da página inicial.
const RPE_BOARD = [
  "API Transacional (Acheron)",
  "Embossing de cartões",
  "Cartões",
  "Motor de Crédito",
  "Autorizador Private Label",
  "Autenticação",
  "Produtos",
  "Seguros",
  "Portadores",
];

// Itens do board: os fixos + qualquer outro componente RPE que não esteja verde.
function rpeBoardItems(rpe) {
  const items = rpe?.items || [];
  const fixed = new Set(RPE_BOARD);
  const inBoard = RPE_BOARD.map((n) =>
    items.find((i) => i.component === n)
  ).filter(Boolean);
  const extras = items.filter(
    (i) => !fixed.has(i.component) && statusColor(i.status) !== "green"
  );
  return [...inBoard, ...extras];
}

// PSPs da Linx sempre exibidos no board da página inicial.
const LINX_BOARD = ["Santander", "Pagar.me"];

function linxBoardItems(linx) {
  const items = linx?.items || [];
  const fixed = new Set(LINX_BOARD);
  const inBoard = items.filter((i) => fixed.has(i.component));
  const extras = items.filter(
    (i) => !fixed.has(i.component) && statusColor(i.status) !== "green"
  );
  return [...inBoard, ...extras];
}

// SEFAZ no painel: so aparece autorizador amarelo ou vermelho.
function sefazBoardItems(sefaz) {
  const items = sefaz?.items || [];
  return items.filter((i) => {
    const c = statusColor(i.status);
    return c === "yellow" || c === "red";
  });
}

// TecnoSpeed no painel: so aparece UF/doc amarelo ou vermelho.
function tecnoBoardItems(tecno) {
  const items = tecno?.items || [];
  return items.filter((i) => {
    const c = statusColor(i.status);
    return c === "yellow" || c === "red";
  });
}

function levelFromLists(problems, warnings) {
  if (problems.length) return "red";
  if (warnings.length) return "yellow";
  return "green";
}

// Agrega o status de uma fonte (lista de problemas/alertas).
function collectEndpoints(endpoints) {
  const p = [];
  const w = [];
  for (const ep of endpoints || []) {
    const c = farolStatus(ep).color;
    if (c === "red") p.push(ep.name);
    else if (c === "yellow") w.push(ep.name);
  }
  return { p, w };
}

function collectItems(items) {
  const p = [];
  const w = [];
  for (const it of items || []) {
    const c = statusColor(it.status);
    if (c === "red") p.push(it.component);
    else if (c === "yellow") w.push(it.component);
  }
  return { p, w };
}

// id do DOM do primeiro endpoint afetado (prioriza amarelo, depois vermelho).
function firstAffectedApi(endpoints) {
  let red = null;
  for (const ep of endpoints || []) {
    const c = farolStatus(ep).color;
    if (c === "yellow") return `api-card-${ep.id}`;
    if (c === "red" && red === null) red = `api-card-${ep.id}`;
  }
  return red;
}

// id do DOM do primeiro item afetado dentro de uma lista de board.
function firstAffectedItems(items, prefix) {
  let red = null;
  for (let i = 0; i < items.length; i++) {
    const c = statusColor(items[i].status);
    if (c === "yellow") return `${prefix}-card-${i}`;
    if (c === "red" && red === null) red = `${prefix}-card-${i}`;
  }
  return red;
}

function StatusChip({
  label,
  problems,
  warnings,
  targetId,
  targetTab,
  onNavigate,
}) {
  const level = levelFromLists(problems, warnings);
  const text =
    level === "green"
      ? "Operacional"
      : level === "red"
        ? `${problems.length} com problema`
        : `${warnings.length} em alerta`;
  const clickable = level !== "green" && targetId;
  const title = clickable
    ? `Clique para ir ao card · ${[...problems, ...warnings].join(" · ")}`
    : [...problems, ...warnings].join(" · ");
  return (
    <div
      className={`status-chip sc-${level}${clickable ? " clickable" : ""}`}
      title={title}
      onClick={
        clickable ? () => onNavigate(targetId, targetTab) : undefined
      }
      role={clickable ? "button" : undefined}
    >
      <span className={`farol farol-${level}`} />
      <span>
        <strong>{label}</strong> — {text}
        {clickable && <span className="chip-go"> →</span>}
      </span>
    </div>
  );
}

function GlobalBanner({
  endpoints,
  rpe,
  linx,
  invoicy,
  sefaz,
  tecno,
  onNavigate,
}) {
  const a = collectEndpoints(endpoints);
  const l = collectItems(linx?.items);
  const r = collectItems(rpe?.items);
  const i = collectItems(invoicy?.items);
  const s = collectItems(sefaz?.items);
  const t = collectItems(tecno?.items);
  return (
    <div className="status-row">
      <StatusChip
        label="APIs"
        problems={a.p}
        warnings={a.w}
        targetId={firstAffectedApi(endpoints)}
        targetTab="painel"
        onNavigate={onNavigate}
      />
      <StatusChip
        label="Linx"
        problems={l.p}
        warnings={l.w}
        targetId={firstAffectedItems(linxBoardItems(linx), "linx")}
        targetTab="painel"
        onNavigate={onNavigate}
      />
      <StatusChip
        label="RPE"
        problems={r.p}
        warnings={r.w}
        targetId={firstAffectedItems(rpeBoardItems(rpe), "rpe")}
        targetTab="painel"
        onNavigate={onNavigate}
      />
      <StatusChip
        label="Invoicy"
        problems={i.p}
        warnings={i.w}
        targetId={firstAffectedItems(invoicy?.items || [], "invoicy")}
        targetTab="invoicy"
        onNavigate={onNavigate}
      />
      <StatusChip
        label="SEFAZ"
        problems={s.p}
        warnings={s.w}
        targetId={firstAffectedItems(sefaz?.items || [], "sefaz")}
        targetTab="sefaz"
        onNavigate={onNavigate}
      />
      <StatusChip
        label="TecnoSpeed"
        problems={t.p}
        warnings={t.w}
        targetId={firstAffectedItems(tecno?.items || [], "tecno")}
        targetTab="tecno"
        onNavigate={onNavigate}
      />
    </div>
  );
}

// Mapeia o texto de status (RPE/Linx/SEFAZ/TecnoSpeed) numa cor de farol.
function statusColor(status) {
  const s = (status || "").toLowerCase();
  if (s.includes("operacional") || s.includes("normal")) return "green";
  if (
    s.includes("inativo") ||
    s.includes("sem dados") ||
    s.includes("timeout")
  )
    return "gray";
  if (s.includes("manuten") || s.includes("informativo")) return "blue";
  if (
    s.includes("alerta") ||
    s.includes("degrad") ||
    s.includes("parcial") ||
    s.includes("lento")
  )
    return "yellow";
  if (!s) return "gray";
  return "red";
}

function SefazGrid({ data, error, idPrefix = "sefaz" }) {
  if (error) return <div className="error-msg">⚠ {error}</div>;
  if (!data) return <p className="muted">Carregando…</p>;
  if (!data.items?.length)
    return <p className="muted">Nenhum autorizador retornado.</p>;
  return (
    <div className="dash-grid">
      {data.items.map((it, i) => {
        const color = statusColor(it.status);
        const down = color === "red";
        return (
          <div
            key={`${it.component}-${i}`}
            id={`${idPrefix}-card-${i}`}
            className={down ? "dash-card dash-card-down" : "dash-card"}
          >
            {down && <div className="down-banner">⚠ {it.status}</div>}
            <div className="dash-head">
              <span className={`farol farol-${color}`} title={it.status} />
              <div>
                <strong>{it.component}</strong>
                <div className="muted" style={{ fontSize: "0.74rem" }}>
                  {it.status} · Tempo médio: {it.tempo_medio || "—"}
                </div>
              </div>
            </div>
            <div className="sefaz-services">
              {(it.services || []).map((svc) => {
                const c = statusColor(svc.status);
                return (
                  <span
                    key={svc.name}
                    className="sefaz-svc"
                    title={`${svc.name}: ${svc.status}`}
                  >
                    <span className={`farol farol-${c}`} />
                    {svc.name}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusGrid({ data, error, idPrefix }) {
  if (error) return <div className="error-msg">⚠ {error}</div>;
  if (!data) return <p className="muted">Carregando…</p>;
  if (!data.items?.length)
    return <p className="muted">Nenhum componente retornado.</p>;
  return (
    <div className="dash-grid">
      {data.items.map((it, i) => {
        const color = statusColor(it.status);
        const down = color === "red";
        return (
          <div
            key={`${it.component}-${i}`}
            id={idPrefix ? `${idPrefix}-card-${i}` : undefined}
            className={down ? "dash-card dash-card-down" : "dash-card"}
          >
            {down && <div className="down-banner">⚠ {it.status}</div>}
            <div className="dash-head">
              <span className={`farol farol-${color}`} title={it.status} />
              <div>
                <strong>{it.component}</strong>
                <div className="muted" style={{ fontSize: "0.74rem" }}>
                  {it.status || "—"}
                  {it.system ? ` · ${it.system}` : ""}
                </div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: "0.74rem" }}>
              {it.updated_at ? `atualizado: ${it.updated_at}` : " "}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState("painel");
  const [endpoints, setEndpoints] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: "",
    url: "",
    method: "GET",
    auth_username: "",
    auth_password: "",
    verify_ssl: true,
    latency_threshold_ms: "",
    token_url: "",
    token_payload: "",
    token_content_type: "application/x-www-form-urlencoded",
    token_field: "access_token",
  });
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [editId, setEditId] = useState(null);
  const [history, setHistory] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [intervalInput, setIntervalInput] = useState("");
  const [savingInterval, setSavingInterval] = useState(false);
  const [rpe, setRpe] = useState(null);
  const [rpeError, setRpeError] = useState(null);
  const [linx, setLinx] = useState(null);
  const [linxError, setLinxError] = useState(null);
  const [invoicy, setInvoicy] = useState(null);
  const [invoicyError, setInvoicyError] = useState(null);
  const [sefaz, setSefaz] = useState(null);
  const [sefazError, setSefazError] = useState(null);
  const [tecno, setTecno] = useState(null);
  const [tecnoError, setTecnoError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsOnlyFailures, setLogsOnlyFailures] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.listEndpoints();
      setEndpoints(data);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setIntervalInput(String(s.check_interval_minutes));
    } catch {
      /* ignora; mantém o que tiver */
    }
  }, []);

  const loadRpe = useCallback(async () => {
    try {
      const d = await api.rpeStatus();
      setRpe(d);
      setRpeError(null);
    } catch (e) {
      setRpeError(e.message);
    }
  }, []);

  const loadLinx = useCallback(async () => {
    try {
      const d = await api.linxStatus();
      setLinx(d);
      setLinxError(null);
    } catch (e) {
      setLinxError(e.message);
    }
  }, []);

  const loadInvoicy = useCallback(async () => {
    try {
      const d = await api.invoicyStatus();
      setInvoicy(d);
      setInvoicyError(null);
    } catch (e) {
      setInvoicyError(e.message);
    }
  }, []);

  const loadSefaz = useCallback(async () => {
    try {
      const d = await api.sefazStatus();
      setSefaz(d);
      setSefazError(null);
    } catch (e) {
      setSefazError(e.message);
    }
  }, []);

  const loadTecno = useCallback(async () => {
    try {
      const d = await api.tecnospeedStatus();
      setTecno(d);
      setTecnoError(null);
    } catch (e) {
      setTecnoError(e.message);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const d = await api.logs(150, logsOnlyFailures);
      setLogs(d);
    } catch {
      /* silencioso pra nao poluir; um erro aqui ja apareceria no banner geral */
    }
  }, [logsOnlyFailures]);

  useEffect(() => {
    load();
    loadSettings();
    loadRpe();
    loadLinx();
    loadInvoicy();
    loadSefaz();
    loadTecno();
    loadLogs();
    // Tela principal se atualiza sozinha a cada 10s.
    const t = setInterval(() => {
      load();
      loadRpe();
      loadLinx();
      loadInvoicy();
      loadSefaz();
      loadTecno();
      loadLogs();
    }, 10000);
    return () => clearInterval(t);
  }, [
    load,
    loadSettings,
    loadRpe,
    loadLinx,
    loadInvoicy,
    loadSefaz,
    loadTecno,
    loadLogs,
  ]);

  function goToCard(id, targetTab = "painel") {
    setTab(targetTab);
    // Espera a aba renderizar antes de rolar até o card.
    setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 2000);
    }, 80);
  }

  async function handleRefreshAll() {
    setRefreshing(true);
    try {
      await api.checkAll();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSaveInterval(e) {
    e.preventDefault();
    const m = parseInt(intervalInput, 10);
    if (!Number.isInteger(m) || m < 1) {
      setError("Intervalo inválido (mínimo 1 minuto).");
      return;
    }
    setSavingInterval(true);
    try {
      const s = await api.updateSettings({ check_interval_minutes: m });
      setIntervalInput(String(s.check_interval_minutes));
      setError(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingInterval(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.url.trim()) return;
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        url: form.url,
        method: form.method,
        verify_ssl: form.verify_ssl,
      };
      // Só envia credenciais se preenchidas (senão ficam null no banco).
      if (form.auth_username.trim()) {
        payload.auth_username = form.auth_username.trim();
        payload.auth_password = form.auth_password;
      }
      const limit = parseInt(form.latency_threshold_ms, 10);
      if (Number.isInteger(limit) && limit > 0) {
        payload.latency_threshold_ms = limit;
      }
      if (form.token_url.trim()) {
        payload.token_url = form.token_url.trim();
        payload.token_payload = form.token_payload;
        payload.token_content_type =
          form.token_content_type ||
          "application/x-www-form-urlencoded";
        payload.token_field = form.token_field || "access_token";
      }
      await api.createEndpoint(payload);
      setForm({
        name: "",
        url: "",
        method: "GET",
        auth_username: "",
        auth_password: "",
        verify_ssl: true,
        latency_threshold_ms: "",
        token_url: "",
        token_payload: "",
        token_content_type: "application/x-www-form-urlencoded",
        token_field: "access_token",
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(ep) {
    try {
      await api.updateEndpoint(ep.id, { is_active: !ep.is_active });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleSsl(ep) {
    try {
      await api.updateEndpoint(ep.id, { verify_ssl: !ep.verify_ssl });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm(`Remover o endpoint #${id}? O histórico também será apagado.`))
      return;
    try {
      await api.deleteEndpoint(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveEdit(id, payload) {
    try {
      await api.updateEndpoint(id, payload);
      setEditId(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSetThreshold(ep, raw) {
    const trimmed = String(raw).trim();
    const value = trimmed === "" ? null : parseInt(trimmed, 10);
    if (value !== null && (!Number.isInteger(value) || value <= 0)) {
      setError("Limite inválido (use um número de ms maior que 0).");
      return;
    }
    if ((ep.latency_threshold_ms ?? null) === value) return; // sem mudança
    try {
      await api.updateEndpoint(ep.id, { latency_threshold_ms: value });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCheckNow(id) {
    try {
      await api.checkNow(id);
      await load();
      if (expanded === id) await loadHistory(id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadHistory(id) {
    try {
      const rows = await api.listResults(id, 50);
      setHistory((h) => ({ ...h, [id]: rows }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleExpand(id) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!history[id]) await loadHistory(id);
  }

  // Painel e banner ignoram pausados (so na Administracao aparecem todos).
  const activeEndpoints = endpoints.filter((e) => e.is_active);

  return (
    <main className="container">
      <GlobalBanner
        endpoints={activeEndpoints}
        rpe={rpe}
        linx={linx}
        invoicy={invoicy}
        sefaz={sefaz}
        tecno={tecno}
        onNavigate={goToCard}
      />
      <h1>Endpoint Monitor</h1>
      <p className="subtitle">
        Cadastre endpoints; o backend mede o tempo de resposta automaticamente.
      </p>

      <nav className="tabs">
        <button
          className={tab === "painel" ? "tab active" : "tab"}
          onClick={() => setTab("painel")}
        >
          Painel
        </button>
        <button
          className={tab === "rpe" ? "tab active" : "tab"}
          onClick={() => setTab("rpe")}
        >
          Status RPE
        </button>
        <button
          className={tab === "linx" ? "tab active" : "tab"}
          onClick={() => setTab("linx")}
        >
          Status Linx
        </button>
        <button
          className={tab === "invoicy" ? "tab active" : "tab"}
          onClick={() => setTab("invoicy")}
        >
          Status Invoicy
        </button>
        <button
          className={tab === "sefaz" ? "tab active" : "tab"}
          onClick={() => setTab("sefaz")}
        >
          Status SEFAZ
        </button>
        <button
          className={tab === "tecno" ? "tab active" : "tab"}
          onClick={() => setTab("tecno")}
        >
          Status TecnoSpeed
        </button>
        <button
          className={tab === "log" ? "tab active" : "tab"}
          onClick={() => setTab("log")}
        >
          Log
        </button>
        <button
          className={tab === "admin" ? "tab active" : "tab"}
          onClick={() => setTab("admin")}
        >
          Administração
        </button>
      </nav>

      {error && <div className="error-msg">⚠ {error}</div>}

      {tab === "painel" && (
        <section className="card">
          <div className="card-head">
            <h2>Painel — farol dos endpoints</h2>
            <button onClick={handleRefreshAll} disabled={refreshing}>
              {refreshing ? "Atualizando…" : "↻ Atualizar todos"}
            </button>
          </div>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 14 }}>
            🟢 até +20% da média · 🟡 lento (+20% ou mais) · 🔴 fora do ar ·
            🔵 sem base ainda · ⚪ sem dados — atualiza sozinho a cada 10s
          </p>
          <Dashboard endpoints={activeEndpoints} loading={loading} />

          <h2 style={{ marginTop: 28, marginBottom: 12 }}>Board RPE</h2>
          <p className="muted" style={{ fontSize: "0.78rem", marginBottom: 12 }}>
            Componentes-chave da RPE + qualquer outro que não esteja verde.
          </p>
          <StatusGrid
            data={rpe ? { items: rpeBoardItems(rpe) } : null}
            error={rpeError}
            idPrefix="rpe"
          />

          <h2 style={{ marginTop: 28, marginBottom: 12 }}>Board Linx</h2>
          <p className="muted" style={{ fontSize: "0.78rem", marginBottom: 12 }}>
            PSPs-chave da QrLinx + qualquer outro que não esteja verde.
          </p>
          <StatusGrid
            data={linx ? { items: linxBoardItems(linx) } : null}
            error={linxError}
            idPrefix="linx"
          />

          {(() => {
            const sefazAlerts = sefazBoardItems(sefaz);
            if (sefazError || sefazAlerts.length > 0) {
              return (
                <>
                  <h2 style={{ marginTop: 28, marginBottom: 12 }}>
                    Board SEFAZ
                  </h2>
                  <p
                    className="muted"
                    style={{ fontSize: "0.78rem", marginBottom: 12 }}
                  >
                    Autorizadores NF-e em alerta ou indisponíveis (só aparece
                    quando há problema).
                  </p>
                  <SefazGrid
                    data={{ items: sefazAlerts }}
                    error={sefazError}
                    idPrefix="sefaz-board"
                  />
                </>
              );
            }
            return null;
          })()}

          {(() => {
            const tecnoAlerts = tecnoBoardItems(tecno);
            if (tecnoError || tecnoAlerts.length > 0) {
              return (
                <>
                  <h2 style={{ marginTop: 28, marginBottom: 12 }}>
                    Board TecnoSpeed
                  </h2>
                  <p
                    className="muted"
                    style={{ fontSize: "0.78rem", marginBottom: 12 }}
                  >
                    UFs/documentos com lentidão ou erro (só aparece quando há
                    problema).
                  </p>
                  <StatusGrid
                    data={{ items: tecnoAlerts }}
                    error={tecnoError}
                    idPrefix="tecno-board"
                  />
                </>
              );
            }
            return null;
          })()}
        </section>
      )}

      {tab === "rpe" && (
        <section className="card">
          <div className="card-head">
            <h2>Status RPE</h2>
            <button onClick={loadRpe}>↻ Atualizar</button>
          </div>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 14 }}>
            Componentes lidos do feed público de status.rpe.tech (StatusIQ).
            🟢 operacional · 🟡 degradado · 🔵 manutenção · 🔴 indisponível —
            atualiza sozinho a cada 10s (cache de 60s no servidor)
          </p>
          <StatusGrid data={rpe} error={rpeError} />
        </section>
      )}

      {tab === "linx" && (
        <section className="card">
          <div className="card-head">
            <h2>Status Linx (QrLinx)</h2>
            <button onClick={loadLinx}>↻ Atualizar</button>
          </div>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 14 }}>
            PSPs lidos da API pública de statusqr.linx.com.br. 🟢 operacional ·
            🟡 alerta · ⚪ inativo · 🔴 indisponível — atualiza sozinho a cada
            10s (cache de 60s no servidor)
          </p>
          <StatusGrid data={linx} error={linxError} />
        </section>
      )}

      {tab === "invoicy" && (
        <section className="card">
          <div className="card-head">
            <h2>Status Invoicy (Brasil)</h2>
            <button onClick={loadInvoicy}>↻ Atualizar</button>
          </div>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 14 }}>
            Componentes do grupo <em>Invoicy Brasil</em> de
            status.invoicy.com.br. 🟢 operacional · 🟡 degradado · 🔵 manutenção
            ou informativo · 🔴 indisponível — atualiza sozinho a cada 10s
            (cache 60s no servidor)
          </p>
          <StatusGrid data={invoicy} error={invoicyError} idPrefix="invoicy" />
        </section>
      )}

      {tab === "sefaz" && (
        <section className="card">
          <div className="card-head">
            <h2>Status SEFAZ NF-e</h2>
            <button onClick={loadSefaz}>↻ Atualizar</button>
          </div>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 14 }}>
            Disponibilidade dos autorizadores SEFAZ (
            <em>nfe.fazenda.gov.br/portal/disponibilidade.aspx</em>). Cada card
            mostra o pior estado entre os 7 serviços. 🟢 operacional · 🟡
            alerta · 🔴 indisponível · ⚪ N/A — atualiza sozinho a cada 10s
            (cache 60s no servidor)
            {sefaz?.checked_at && (
              <>
                {" "}
                · última verificação SEFAZ: <strong>{sefaz.checked_at}</strong>
              </>
            )}
          </p>
          <SefazGrid data={sefaz} error={sefazError} />
        </section>
      )}

      {tab === "tecno" && (
        <section className="card">
          <div className="card-head">
            <h2>Status TecnoSpeed (NFe / CTe / NFCe)</h2>
            <button onClick={loadTecno}>↻ Atualizar</button>
          </div>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 14 }}>
            Status por UF do dashboard público{" "}
            <em>monitor.tecnospeed.com.br</em>. 🟢 Normal (≤2s) · 🟡 Lento /
            Muito lento · ⚪ Timeout · 🔴 Erro — atualiza sozinho a cada 10s
            (cache 60s no servidor)
          </p>
          <StatusGrid data={tecno} error={tecnoError} idPrefix="tecno" />
        </section>
      )}

      {tab === "log" && (
        <section className="card">
          <div className="card-head">
            <h2>Log de checagens</h2>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <label
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  fontSize: "0.85rem",
                }}
              >
                <input
                  type="checkbox"
                  style={{ minWidth: "auto", width: 16, height: 16 }}
                  checked={logsOnlyFailures}
                  onChange={(e) => setLogsOnlyFailures(e.target.checked)}
                />
                Só falhas
              </label>
              <button onClick={loadLogs}>↻ Atualizar</button>
            </div>
          </div>
          <p className="muted" style={{ fontSize: "0.78rem", marginBottom: 14 }}>
            Histórico de todas as checagens (sucesso e falha), ordenado da mais
            recente. Atualiza sozinho a cada 10s.
          </p>
          <LogTable rows={logs} />
        </section>
      )}

      {tab === "admin" && (
        <>
          <section className="card">
            <h2>Configuração</h2>
            <form onSubmit={handleSaveInterval}>
              <div className="field">
                <label htmlFor="interval">
                  Intervalo entre consultas (minutos)
                </label>
                <input
                  id="interval"
                  type="number"
                  min="1"
                  value={intervalInput}
                  onChange={(e) => setIntervalInput(e.target.value)}
                />
              </div>
              <button type="submit" disabled={savingInterval}>
                {savingInterval ? "Salvando…" : "Salvar intervalo"}
              </button>
            </form>
            <p className="muted" style={{ marginTop: 10, fontSize: "0.78rem" }}>
              Aplica imediatamente no agendador e persiste no banco (vale para
              todos os endpoints).
            </p>
          </section>

          <section className="card">
            <h2>Novo endpoint</h2>
            <form onSubmit={handleCreate}>
              <div className="field">
                <label htmlFor="name">Nome</label>
                <input
                  id="name"
                  value={form.name}
                  placeholder="API de produtos"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="url">URL</label>
                <input
                  id="url"
                  style={{ width: "100%" }}
                  value={form.url}
                  placeholder="https://exemplo.com/health"
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="method">Método</label>
                <select
                  id="method"
                  value={form.method}
                  onChange={(e) =>
                    setForm({ ...form, method: e.target.value })
                  }
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="auth_username">Usuário (opcional)</label>
                <input
                  id="auth_username"
                  value={form.auth_username}
                  placeholder="se exigir auth"
                  autoComplete="off"
                  onChange={(e) =>
                    setForm({ ...form, auth_username: e.target.value })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="auth_password">Senha (opcional)</label>
                <input
                  id="auth_password"
                  type="password"
                  value={form.auth_password}
                  placeholder="••••••"
                  autoComplete="new-password"
                  onChange={(e) =>
                    setForm({ ...form, auth_password: e.target.value })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="verify_ssl">Certificado SSL</label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: "0.85rem",
                    height: 38,
                  }}
                >
                  <input
                    id="verify_ssl"
                    type="checkbox"
                    style={{ minWidth: "auto", width: 16, height: 16 }}
                    checked={form.verify_ssl}
                    onChange={(e) =>
                      setForm({ ...form, verify_ssl: e.target.checked })
                    }
                  />
                  Verificar
                </label>
              </div>
              <div className="field">
                <label htmlFor="latency_threshold_ms">Limite (ms)</label>
                <input
                  id="latency_threshold_ms"
                  type="number"
                  min="1"
                  style={{ minWidth: 110 }}
                  placeholder="opcional"
                  value={form.latency_threshold_ms}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      latency_threshold_ms: e.target.value,
                    })
                  }
                />
              </div>
              <button type="submit" disabled={submitting}>
                {submitting ? "Salvando…" : "Adicionar"}
              </button>
              <details
                style={{ width: "100%", marginTop: 4 }}
                open={!!form.token_url}
              >
                <summary
                  className="muted"
                  style={{ cursor: "pointer", fontSize: "0.85rem" }}
                >
                  OAuth bearer token (opcional)
                </summary>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    marginTop: 10,
                    alignItems: "flex-end",
                  }}
                >
                  <div className="field" style={{ flex: 2 }}>
                    <label>Token URL</label>
                    <input
                      style={{ width: "100%" }}
                      value={form.token_url}
                      placeholder="https://idp.exemplo/oauth/token"
                      onChange={(e) =>
                        setForm({ ...form, token_url: e.target.value })
                      }
                    />
                  </div>
                  <div className="field" style={{ flex: 3 }}>
                    <label>Payload (body)</label>
                    <input
                      style={{ width: "100%" }}
                      value={form.token_payload}
                      placeholder="grant_type=client_credentials&client_id=X&client_secret=Y&scope=..."
                      onChange={(e) =>
                        setForm({ ...form, token_payload: e.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Content-Type</label>
                    <select
                      value={form.token_content_type}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          token_content_type: e.target.value,
                        })
                      }
                    >
                      <option value="application/x-www-form-urlencoded">
                        form-urlencoded
                      </option>
                      <option value="application/json">json</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Campo do token</label>
                    <input
                      style={{ minWidth: 130 }}
                      value={form.token_field}
                      placeholder="access_token"
                      onChange={(e) =>
                        setForm({ ...form, token_field: e.target.value })
                      }
                    />
                  </div>
                </div>
              </details>
            </form>
            <p
              className="muted"
              style={{ marginTop: 10, fontSize: "0.78rem" }}
            >
              Usuário/senha usam HTTP Basic Auth na requisição ao endpoint
              monitorado. Deixe em branco se não for necessário.
            </p>
          </section>

          <section className="card">
            <h2>Endpoints monitorados</h2>
            {loading ? (
              <p className="muted">Carregando…</p>
            ) : endpoints.length === 0 ? (
              <p className="muted">Nenhum endpoint cadastrado ainda.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nome / URL</th>
                    <th>Último status</th>
                    <th>Tempo</th>
                    <th>Checado em</th>
                    <th>Próxima consulta</th>
                    <th>Limite (ms)</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((ep) => (
                    <FragmentRow
                      key={ep.id}
                      ep={ep}
                      expanded={expanded === ep.id}
                      history={history[ep.id]}
                      onToggleExpand={() => toggleExpand(ep.id)}
                      onCheckNow={() => handleCheckNow(ep.id)}
                      onToggleActive={() => handleToggle(ep)}
                      onToggleSsl={() => handleToggleSsl(ep)}
                      onSetThreshold={(v) => handleSetThreshold(ep, v)}
                      onDelete={() => handleDelete(ep.id)}
                      isEditing={editId === ep.id}
                      onEdit={() => setEditId(ep.id)}
                      onCancelEdit={() => setEditId(null)}
                      onSaveEdit={(payload) => handleSaveEdit(ep.id, payload)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function FragmentRow({
  ep,
  expanded,
  history,
  onToggleExpand,
  onCheckNow,
  onToggleActive,
  onToggleSsl,
  onSetThreshold,
  onDelete,
  isEditing,
  onEdit,
  onCancelEdit,
  onSaveEdit,
}) {
  const last = ep.last_result;
  return (
    <>
      <tr>
        <td>#{ep.id}</td>
        <td>
          <strong>{ep.name}</strong>
          {ep.has_auth && (
            <span
              title={`Basic Auth (usuário: ${ep.auth_username || "—"})`}
              style={{ marginLeft: 6 }}
            >
              🔒
            </span>
          )}
          {ep.has_token && (
            <span
              title={`Bearer token via ${ep.token_url || "—"}`}
              style={{ marginLeft: 6 }}
            >
              🔑
            </span>
          )}
          <br />
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            {ep.method} {ep.url}
          </span>
          {!ep.is_active && (
            <span className="badge idle" style={{ marginLeft: 8 }}>
              pausado
            </span>
          )}
          {ep.verify_ssl === false && (
            <span
              className="badge fail"
              style={{ marginLeft: 8 }}
              title="Verificação de certificado TLS desligada"
            >
              SSL off
            </span>
          )}
        </td>
        <td>
          <ResultBadge result={last} />
        </td>
        <td>{fmtMs(last?.response_time_ms)}</td>
        <td className="muted">{fmtTime(last?.checked_at)}</td>
        <td className="muted">{fmtNext(ep.next_check_at, ep.is_active)}</td>
        <td>
          <input
            type="number"
            min="1"
            key={ep.latency_threshold_ms ?? "none"}
            defaultValue={ep.latency_threshold_ms ?? ""}
            placeholder="média"
            title="Vazio = usa a média. Definido = amarelo acima deste valor."
            style={{ minWidth: 80, width: 90, padding: "6px 8px" }}
            onBlur={(e) => onSetThreshold(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </td>
        <td>
          <div className="row-actions">
            <button className="ghost" onClick={onToggleExpand}>
              {expanded ? "Ocultar" : "Histórico"}
            </button>
            <button className="ghost" onClick={onCheckNow}>
              Checar agora
            </button>
            <button className="ghost" onClick={onEdit}>
              Editar
            </button>
            <button className="ghost" onClick={onToggleActive}>
              {ep.is_active ? "Desativar" : "Ativar"}
            </button>
            <button
              className="ghost"
              onClick={onToggleSsl}
              title="Liga/desliga a verificação do certificado TLS"
            >
              {ep.verify_ssl === false ? "SSL: ligar" : "SSL: desligar"}
            </button>
            <button className="danger" onClick={onDelete}>
              Excluir
            </button>
          </div>
        </td>
      </tr>
      {isEditing && (
        <tr className="history-row">
          <td colSpan={8}>
            <EditRow ep={ep} onSave={onSaveEdit} onCancel={onCancelEdit} />
          </td>
        </tr>
      )}
      {expanded && (
        <tr className="history-row">
          <td colSpan={8}>
            {!history ? (
              <span className="muted">Carregando histórico…</span>
            ) : history.length === 0 ? (
              <span className="muted">Sem checagens ainda.</span>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Status</th>
                    <th>Tempo</th>
                    <th>Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((r) => (
                    <tr key={r.id}>
                      <td>{fmtTime(r.checked_at)}</td>
                      <td>
                        <ResultBadge result={r} />
                      </td>
                      <td>{fmtMs(r.response_time_ms)}</td>
                      <td className="muted">{r.error || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function EditRow({ ep, onSave, onCancel }) {
  const [f, setF] = useState({
    name: ep.name,
    url: ep.url,
    method: ep.method,
    auth_username: ep.auth_username || "",
    auth_password: "",
    verify_ssl: ep.verify_ssl !== false,
    latency_threshold_ms: ep.latency_threshold_ms ?? "",
    token_url: ep.token_url || "",
    token_payload: "",
    token_content_type:
      ep.token_content_type || "application/x-www-form-urlencoded",
    token_field: ep.token_field || "access_token",
  });

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim() || !f.url.trim()) return;
    const limitRaw = String(f.latency_threshold_ms).trim();
    const limit = limitRaw === "" ? null : parseInt(limitRaw, 10);
    if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) return;
    const payload = {
      name: f.name.trim(),
      url: f.url.trim(),
      method: f.method,
      verify_ssl: f.verify_ssl,
      auth_username: f.auth_username.trim() ? f.auth_username.trim() : null,
      latency_threshold_ms: limit,
    };
    // Senha em branco = mantém a atual; preenchida = troca.
    if (f.auth_password) payload.auth_password = f.auth_password;
    // OAuth: token_url preenchido configura/mantem; vazio limpa tudo.
    const hadToken = !!ep.token_url;
    if (f.token_url.trim()) {
      payload.token_url = f.token_url.trim();
      payload.token_content_type =
        f.token_content_type || "application/x-www-form-urlencoded";
      payload.token_field = f.token_field || "access_token";
      // Payload em branco = mantem o atual (similar a senha).
      if (f.token_payload) payload.token_payload = f.token_payload;
    } else if (hadToken) {
      payload.token_url = null;
      payload.token_payload = null;
      payload.token_content_type = null;
      payload.token_field = null;
    }
    onSave(payload);
  }

  return (
    <form onSubmit={submit} style={{ alignItems: "flex-end" }}>
      <div className="field" style={{ flex: 1 }}>
        <label>Nome</label>
        <input
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </div>
      <div className="field" style={{ flex: 2 }}>
        <label>URL</label>
        <input
          style={{ width: "100%" }}
          value={f.url}
          onChange={(e) => setF({ ...f, url: e.target.value })}
        />
      </div>
      <div className="field">
        <label>Método</label>
        <select
          value={f.method}
          onChange={(e) => setF({ ...f, method: e.target.value })}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Usuário</label>
        <input
          value={f.auth_username}
          autoComplete="off"
          onChange={(e) => setF({ ...f, auth_username: e.target.value })}
        />
      </div>
      <div className="field">
        <label>Senha</label>
        <input
          type="password"
          value={f.auth_password}
          placeholder="manter atual"
          autoComplete="new-password"
          onChange={(e) => setF({ ...f, auth_password: e.target.value })}
        />
      </div>
      <div className="field">
        <label>Limite (ms)</label>
        <input
          type="number"
          min="1"
          style={{ minWidth: 100 }}
          placeholder="média"
          value={f.latency_threshold_ms}
          onChange={(e) =>
            setF({ ...f, latency_threshold_ms: e.target.value })
          }
        />
      </div>
      <div className="field">
        <label>SSL</label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: "0.85rem",
            height: 38,
          }}
        >
          <input
            type="checkbox"
            style={{ minWidth: "auto", width: 16, height: 16 }}
            checked={f.verify_ssl}
            onChange={(e) => setF({ ...f, verify_ssl: e.target.checked })}
          />
          Verificar
        </label>
      </div>
      <button type="submit">Salvar</button>
      <button type="button" className="ghost" onClick={onCancel}>
        Cancelar
      </button>
      <details
        style={{ width: "100%", marginTop: 4 }}
        open={!!f.token_url}
      >
        <summary
          className="muted"
          style={{ cursor: "pointer", fontSize: "0.85rem" }}
        >
          OAuth bearer token (opcional)
        </summary>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 10,
            alignItems: "flex-end",
          }}
        >
          <div className="field" style={{ flex: 2 }}>
            <label>Token URL</label>
            <input
              style={{ width: "100%" }}
              value={f.token_url}
              placeholder="https://idp.exemplo/oauth/token"
              onChange={(e) => setF({ ...f, token_url: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: 3 }}>
            <label>Payload</label>
            <input
              style={{ width: "100%" }}
              value={f.token_payload}
              placeholder={
                ep.has_token
                  ? "manter atual (em branco)"
                  : "grant_type=client_credentials&client_id=...&client_secret=..."
              }
              onChange={(e) => setF({ ...f, token_payload: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Content-Type</label>
            <select
              value={f.token_content_type}
              onChange={(e) =>
                setF({ ...f, token_content_type: e.target.value })
              }
            >
              <option value="application/x-www-form-urlencoded">
                form-urlencoded
              </option>
              <option value="application/json">json</option>
            </select>
          </div>
          <div className="field">
            <label>Campo</label>
            <input
              style={{ minWidth: 120 }}
              value={f.token_field}
              placeholder="access_token"
              onChange={(e) => setF({ ...f, token_field: e.target.value })}
            />
          </div>
        </div>
      </details>
    </form>
  );
}
