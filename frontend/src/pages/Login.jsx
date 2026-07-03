import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../api/auth.jsx";
import { api } from "../api/client.js";
import { getLang, setLang } from "../i18n.js";
import { ThemeToggle } from "../App.jsx";
import { t } from "../i18n.js";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  // null = ещё выясняем; true = первый запуск (нет пользователей); false = обычный вход
  const [needsSetup, setNeedsSetup] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/api/auth/setup-status")
      .then((s) => setNeedsSetup(!!s.needs_setup))
      .catch(() => setNeedsSetup(false));
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (needsSetup && password !== password2) {
      setError(t("Пароли не совпадают"));
      return;
    }
    setBusy(true);
    try {
      if (needsSetup) {
        await api.post("/api/auth/setup", { email, password });
      }
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (needsSetup === null) return null; // не мигаем формой, пока не знаем режим

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={onSubmit}>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <ThemeToggle />
          <div className="lang-switch">
            {["ru", "en"].map((l) => (
              <button type="button" key={l} className={l === getLang() ? "lang-btn active" : "lang-btn"} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
            ))}
          </div>
        </div>
        {needsSetup ? (
          <>
            <h1>{t("Первый запуск")}</h1>
            <p className="muted" style={{ marginTop: 0 }}>
              {t("Создайте учётную запись администратора — с ней вы будете входить в Filament Tracker.")}
            </p>
            <label>Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <label>{t("Пароль (не короче 6 символов)")}</label>
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
            <label>{t("Повторите пароль")}</label>
            <input type="password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
            <button style={{ marginTop: 16, width: "100%" }} disabled={busy}>
              {t("Создать администратора")}
            </button>
          </>
        ) : (
          <>
            <h1>{t("Вход")}</h1>
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
            <label>{t("Пароль")}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button style={{ marginTop: 16, width: "100%" }} disabled={busy}>{t("Войти")}</button>
          </>
        )}
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
