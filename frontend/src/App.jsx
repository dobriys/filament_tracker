import { Navigate, Route, Routes, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "./api/auth.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Spools from "./pages/Spools.jsx";
import SpoolDetail from "./pages/SpoolDetail.jsx";
import SpoolForm from "./pages/SpoolForm.jsx";
import Profiles from "./pages/Profiles.jsx";
import ProfileForm from "./pages/ProfileForm.jsx";
import Locations from "./pages/Locations.jsx";
import Printers from "./pages/Printers.jsx";
import GcodeUpload from "./pages/GcodeUpload.jsx";
import PrintJobs from "./pages/PrintJobs.jsx";
import ConsumeJob from "./pages/ConsumeJob.jsx";
import SpoolByQr from "./pages/SpoolByQr.jsx";
import Settings from "./pages/Settings.jsx";
import { t, getLang, setLang } from "./i18n.js";
import { getTheme, setTheme } from "./theme.js";
import { useState } from "react";

export function ThemeToggle() {
  const [theme, set] = useState(getTheme());
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      className="secondary theme-btn"
      title={next === "dark" ? t("Тёмная тема") : t("Светлая тема")}
      onClick={() => { setTheme(next); set(next); }}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}

function LangSwitch() {
  const lang = getLang();
  return (
    <div className="lang-switch">
      {["ru", "en"].map((l) => (
        <button
          key={l}
          className={l === lang ? "lang-btn active" : "lang-btn"}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="app-shell">
      <header className="topnav">
        <div className="topnav-inner">
          <div className="brand">Filament Tracker</div>
          <nav className="topnav-links">
            <NavLink to="/" end>{t("Панель")}</NavLink>
            <NavLink to="/spools">{t("Мои Катушки")}</NavLink>
            <NavLink to="/printers">{t("Принтеры")}</NavLink>
            <NavLink to="/print-jobs">{t("История")}</NavLink>
            <NavLink to="/settings">{t("Настройки")}</NavLink>
            <div className="nav-more">
              <span className="nav-more-btn">{t("Ещё ▾")}</span>
              <div className="nav-more-menu">
                <NavLink to="/profiles">{t("Профили пластика")}</NavLink>
                <NavLink to="/locations">{t("Места хранения")}</NavLink>
                <NavLink to="/gcode">{t("Загрузка gcode")}</NavLink>
              </div>
            </div>
          </nav>
          <div className="topnav-actions">
            <ThemeToggle />
            <LangSwitch />
            <span className="muted" style={{ fontSize: 13 }}>{user?.email}</span>
            <button className="secondary" onClick={() => { logout(); navigate("/login"); }}>{t("Выйти")}</button>
          </div>
        </div>
      </header>
      <main className="app-content">{children}</main>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40 }}>{t("Загрузка…")}</div>;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/spools" element={<Spools />} />
        <Route path="/spools/new" element={<SpoolForm />} />
        <Route path="/spools/:id/edit" element={<SpoolForm />} />
        <Route path="/spools/:id" element={<SpoolDetail />} />
        <Route path="/s/:token" element={<SpoolByQr />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/profiles/new" element={<ProfileForm />} />
        <Route path="/profiles/:id/edit" element={<ProfileForm />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/printers" element={<Printers />} />
        <Route path="/gcode" element={<GcodeUpload />} />
        <Route path="/print-jobs" element={<PrintJobs />} />
        <Route path="/print-jobs/:id/consume" element={<ConsumeJob />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
