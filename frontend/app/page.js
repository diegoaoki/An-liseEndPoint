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

export default function Home() {
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

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

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

      {error && <div className="error-msg">⚠ {error}</div>}

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
              onChange={(e) => setForm({ ...form, method: e.target.value })}
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
        <p className="muted" style={{ marginTop: 10, fontSize: "0.78rem" }}>
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
