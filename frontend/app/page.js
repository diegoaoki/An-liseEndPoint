"use client";

import { useCallback, useEffect, useState } from "react";
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
const RED_THRESHOLD = 1.5; // acima de +50% é vermelho (entre os dois = amarelo)

// Decide a cor do farol comparando a última consulta com a média anterior.
function farolStatus(ep) {
  const last = ep.last_result;
  if (!last) return { color: "gray", texto: "Sem dados" };
  if (!last.success) return { color: "red", texto: "Falha na última consulta" };
  const avg = ep.avg_response_time_ms;
  const lastMs = last.response_time_ms;
  if (avg == null || lastMs == null) {
    return { color: "blue", texto: "Sem base de comparação ainda" };
  }
  if (lastMs <= avg * GREEN_THRESHOLD) {
    return { color: "green", texto: "Dentro da média" };
  }
  if (lastMs <= avg * RED_THRESHOLD) {
    const pct = Math.round((lastMs / avg - 1) * 100);
    return { color: "yellow", texto: `Levemente lento (+${pct}%)` };
  }
  const pct = Math.round((lastMs / avg - 1) * 100);
  return { color: "red", texto: `Muito lento (+${pct}% da média)` };
}

function Farol({ ep }) {
  const { color, texto } = farolStatus(ep);
  const last = ep.last_result;
  const avg = ep.avg_response_time_ms;
  // Card agressivo quando a última consulta falhou (endpoint fora do ar).
  const isDown = last && !last.success;
  return (
    <div className={isDown ? "dash-card dash-card-down" : "dash-card"}>
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

function Dashboard({ endpoints, loading }) {
  if (loading) return <p className="muted">Carregando…</p>;
  if (endpoints.length === 0)
    return <p className="muted">Nenhum endpoint cadastrado ainda.</p>;
  return (
    <div className="dash-grid">
      {endpoints.map((ep) => (
        <Farol key={ep.id} ep={ep} />
      ))}
    </div>
  );
}

// Mapeia o texto de status (RPE/Linx) numa cor de farol.
function statusColor(status) {
  const s = (status || "").toLowerCase();
  if (s.includes("operacional")) return "green";
  if (s.includes("inativo")) return "gray";
  if (s.includes("manuten")) return "blue";
  if (s.includes("alerta") || s.includes("degrad") || s.includes("parcial"))
    return "yellow";
  if (!s) return "gray";
  return "red";
}

function StatusGrid({ data, error }) {
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
  });
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [history, setHistory] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [intervalInput, setIntervalInput] = useState("");
  const [savingInterval, setSavingInterval] = useState(false);
  const [rpe, setRpe] = useState(null);
  const [rpeError, setRpeError] = useState(null);
  const [linx, setLinx] = useState(null);
  const [linxError, setLinxError] = useState(null);

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

  useEffect(() => {
    load();
    loadSettings();
    loadRpe();
    loadLinx();
    // Tela principal se atualiza sozinha a cada 10s.
    const t = setInterval(() => {
      load();
      loadRpe();
      loadLinx();
    }, 10000);
    return () => clearInterval(t);
  }, [load, loadSettings, loadRpe, loadLinx]);

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
      };
      // Só envia credenciais se preenchidas (senão ficam null no banco).
      if (form.auth_username.trim()) {
        payload.auth_username = form.auth_username.trim();
        payload.auth_password = form.auth_password;
      }
      await api.createEndpoint(payload);
      setForm({
        name: "",
        url: "",
        method: "GET",
        auth_username: "",
        auth_password: "",
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
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

  async function handleToggle(ep) {
    try {
      await api.updateEndpoint(ep.id, { is_active: !ep.is_active });
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

  return (
    <main className="container">
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
            🟢 até +20% da média · 🟡 +20% a +50% · 🔴 acima de +50% (ou falha)
            · 🔵 sem base ainda · ⚪ sem dados — atualiza sozinho a cada 10s
          </p>
          <Dashboard endpoints={endpoints} loading={loading} />
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
              <button type="submit" disabled={submitting}>
                {submitting ? "Salvando…" : "Adicionar"}
              </button>
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
                      onDelete={() => handleDelete(ep.id)}
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
  onDelete,
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
          <br />
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            {ep.method} {ep.url}
          </span>
          {!ep.is_active && (
            <span className="badge idle" style={{ marginLeft: 8 }}>
              pausado
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
          <div className="row-actions">
            <button className="ghost" onClick={onToggleExpand}>
              {expanded ? "Ocultar" : "Histórico"}
            </button>
            <button className="ghost" onClick={onCheckNow}>
              Checar agora
            </button>
            <button className="ghost" onClick={onToggleActive}>
              {ep.is_active ? "Pausar" : "Ativar"}
            </button>
            <button className="danger" onClick={onDelete}>
              Excluir
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="history-row">
          <td colSpan={7}>
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
