// Адрес API. Приоритет: runtime-конфиг (config.js, задаётся переменной
// окружения прод-образа без пересборки) → VITE_API_BASE_URL на этапе сборки →
// хост из адресной строки (http://192.168.0.200:5173 → API :8000).
// Явно задавать нужно только за reverse-proxy / доменом.
import { t, tServer } from "../i18n.js";

const BASE =
  window.__FT_CONFIG__?.apiBase ||
  import.meta.env.VITE_API_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}:8000`;

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
  patch: (p, body) => request(p, { method: "PATCH", body }),
  del: (p) => request(p, { method: "DELETE" }),
  download,
  blobUrl,
};
