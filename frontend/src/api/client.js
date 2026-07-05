// Адрес API. По умолчанию пусто = тот же origin: фронт-сервер (nginx в проде,
// vite proxy в деве) проксирует /api и /health на backend — приложение работает
// на одном порту. Переопределяют: runtime-конфиг (config.js из переменной
// окружения прод-образа) → VITE_API_BASE_URL на этапе сборки. Нужно только если
// API вынесен на отдельный адрес/домен без общего reverse-proxy.
import { t, tServer } from "../i18n.js";

const BASE =
  window.__FT_CONFIG__?.apiBase ||
  import.meta.env.VITE_API_BASE_URL ||
  "";

const TOKEN_KEY = "ft_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = "GET", body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let payload;
  if (form) {
    payload = new URLSearchParams(form);
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail || `${t("Ошибка")} ${res.status}`;
    throw new Error(typeof detail === "string" ? tServer(detail) : JSON.stringify(detail));
  }
  return data;
}

async function postFile(path, file) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: fd });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail || `${t("Ошибка")} ${res.status}`;
    throw new Error(typeof detail === "string" ? tServer(detail) : JSON.stringify(detail));
  }
  return data;
}

// Скачивает авторизованный файл (PDF) и сохраняет под именем filename.
async function download(path, { method = "GET", body, filename = "file" } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(typeof data?.detail === "string" ? tServer(data.detail) : (data?.detail ? JSON.stringify(data.detail) : `${t("Ошибка")} ${res.status}`));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Загружает файл и возвращает object URL (для предпросмотра PDF в новой вкладке).
async function blobUrl(path, { method = "GET", body } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  if (!res.ok) throw new Error(`${t("Ошибка")} ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: "POST", body }),
  postForm: (p, form) => request(p, { method: "POST", form }),
  postFile,
  put: (p, body) => request(p, { method: "PUT", body }),
  patch: (p, body) => request(p, { method: "PATCH", body }),
  del: (p) => request(p, { method: "DELETE" }),
  download,
  blobUrl,
};
