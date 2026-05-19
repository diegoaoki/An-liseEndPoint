const BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
).replace(/\/$/, "");

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...options,
  });
  if (!res.ok) {
    let detail = `Erro ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* resposta sem corpo JSON */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listEndpoints: () => request("/endpoints"),
  createEndpoint: (data) =>
    request("/endpoints", { method: "POST", body: JSON.stringify(data) }),
  updateEndpoint: (id, data) =>
    request(`/endpoints/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteEndpoint: (id) =>
    request(`/endpoints/${id}`, { method: "DELETE" }),
  checkNow: (id) =>
    request(`/endpoints/${id}/check`, { method: "POST" }),
  checkAll: () => request(`/check-all`, { method: "POST" }),
  listResults: (id, limit = 50) =>
    request(`/endpoints/${id}/results?limit=${limit}`),
  getSettings: () => request(`/settings`),
  updateSettings: (data) =>
    request(`/settings`, { method: "PUT", body: JSON.stringify(data) }),
};
