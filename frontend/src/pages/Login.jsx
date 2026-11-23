import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Disc01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Card } from "../components/ft/ui.jsx";
import { Notice } from "../components/ft/printer.jsx";
import { LangSwitch, ThemeToggle } from "../components/shell/AppShell.jsx";
import { useAuth } from "../api/auth.jsx";
import { api } from "../api/client.js";
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
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-secondary px-4 py-12 text-primary">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <ThemeToggle />
        <LangSwitch />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-solid text-white shadow-xs">
            <Disc01 className="size-5" aria-hidden="true" />
          </span>
          <span className="text-xl font-semibold text-primary">Filament Tracker</span>
        </div>

        <Card className="p-6 sm:p-8">
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            {needsSetup ? (
              <>
                <div>
                  <h1 className="m-0 text-display-xs font-semibold text-primary">{t("Первый запуск")}</h1>
                  <p className="m-0 mt-1.5 text-sm text-tertiary">
                    {t("Создайте учётную запись администратора — с ней вы будете входить в Filament Tracker.")}
                  </p>
                </div>
                <Input type="email" label="Email" autoComplete="email" isRequired value={email} onChange={setEmail} />
                <Input
                  type="password" label={t("Пароль (не короче 6 символов)")} autoComplete="new-password"
                  isRequired minLength={6} value={password} onChange={setPassword}
                />
                <Input
                  type="password" label={t("Повторите пароль")} autoComplete="new-password"
                  isRequired value={password2} onChange={setPassword2}
                />
              </>
            ) : (
              <>
                <h1 className="m-0 text-display-xs font-semibold text-primary">{t("Вход")}</h1>
                <Input label="Email" autoComplete="username" value={email} onChange={setEmail} />
                <Input type="password" label={t("Пароль")} autoComplete="current-password" value={password} onChange={setPassword} />
              </>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" size="lg" isLoading={busy}>
              {needsSetup ? t("Создать администратора") : t("Войти")}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
