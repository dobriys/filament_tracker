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
import CostEstimate from "./pages/CostEstimate.jsx";
import ConsumeJob from "./pages/ConsumeJob.jsx";
import SpoolByQr from "./pages/SpoolByQr.jsx";
import Settings from "./pages/Settings.jsx";
import { t, getLang, setLang } from "./i18n.js";
import { getTheme, setTheme } from "./theme.js";
import { api } from "./api/client.js";
import { useEffect, useRef, useState } from "react";
import Icon from "./components/Icon.jsx";
import UpdateToast from "./components/UpdateToast.jsx";
import { setLowConfig } from "./utils/spools.js";

// Логотип сайта — иконка катушки (бывший SpoolThumb): кольцо с отверстием.
function Logo({ size = 22 }) {
  return <Icon name="spool" size={size} strokeWidth={2} style={{ color: "var(--accent)" }} />;
}

export function ThemeToggle() {
  const [theme, set] = useState(getTheme());
  const { user } = useAuth();
  const next = theme === "dark" ? "light" : "dark";
  const toggle = () => {
    setTheme(next);
    set(next);
    // Залогиненным сохраняем выбор в аккаунт, чтобы он следовал за пользователем.
    if (user) api.put("/api/auth/me/theme", { theme: next }).catch(() => {});
  };
  return (
    <button
      className="secondary theme-btn"
      title={next === "dark" ? t("Тёмная тема") : t("Светлая тема")}
      onClick={toggle}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
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

// Меню «Ещё» в десктопной шапке.
//
// Раньше оно жило на голом CSS :hover, и по дороге от кнопки к панели курсор
// пересекал зазор в 8px, где нет ни того ни другого, — меню захлопывалось.
// Зазор теперь перекрыт прозрачным мостиком, а на случай, когда курсор
// срезает угол мимо панели, закрытие отложено на четверть секунды.
//
// Заодно триггер стал настоящей кнопкой: <span> не получал фокус, и с
// клавиатуры до «Профилей», «Мест хранения» и «Загрузки gcode» было не дойти.
function NavMore() {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const timer = useRef(null);

  const cancelClose = () => { clearTimeout(timer.current); timer.current = null; };
  const openNow = () => { cancelClose(); setOpen(true); };
  const closeSoon = () => { cancelClose(); timer.current = setTimeout(() => setOpen(false), 250); };

  useEffect(() => cancelClose, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div
      className="nav-more"
      ref={wrap}
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      <button
        type="button"
        className="nav-more-btn"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openNow())}
        onFocus={cancelClose}
      >
        {t("Ещё")} <Icon name="chevron" size={13} />
      </button>
      {open && (
        <div className="nav-more-menu">
          <NavLink to="/cost" onClick={() => setOpen(false)}>{t("Расчёт стоимости")}</NavLink>
          <NavLink to="/profiles" onClick={() => setOpen(false)}>{t("Профили пластика")}</NavLink>
          <NavLink to="/locations" onClick={() => setOpen(false)}>{t("Места хранения")}</NavLink>
          <NavLink to="/gcode" onClick={() => setOpen(false)}>{t("Загрузка gcode")}</NavLink>
        </div>
      )}
    </div>
  );
}

function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const doLogout = () => { setMoreOpen(false); logout(); navigate("/login"); };
  const closeMore = () => setMoreOpen(false);
  return (
    <div className="app-shell">
      <UpdateToast />
      {/* Десктопная шапка */}
      <header className="topnav">
        <div className="topnav-inner">
          <div className="brand"><Logo /> Filament Tracker</div>
          <nav className="topnav-links">
            <NavLink to="/" end>{t("Панель")}</NavLink>
            <NavLink to="/spools">{t("Мои Катушки")}</NavLink>
            <NavLink to="/printers">{t("Принтеры")}</NavLink>
            <NavLink to="/print-jobs">{t("История")}</NavLink>
            <NavLink to="/settings">{t("Настройки")}</NavLink>
            <NavMore />
          </nav>
          <div className="topnav-actions">
            <ThemeToggle />
            <LangSwitch />
            <span className="muted" style={{ fontSize: "var(--fs-3)" }}>{user?.email}</span>
            <button className="secondary" onClick={() => { logout(); navigate("/login"); }}>{t("Выйти")}</button>
          </div>
        </div>
      </header>

      {/* Мобильный топбар */}
      <header className="mobile-topbar">
        <div className="brand"><Logo size={20} /> Filament Tracker</div>
        <div className="mobile-topbar-actions">
          <ThemeToggle />
          <button className="icon-btn mobile-more-btn" onClick={() => setMoreOpen(true)} aria-label={t("Ещё")}>
            <Icon name="menu" size={19} />
          </button>
        </div>
      </header>

      <main className="app-content">{children}</main>

      {/* Мобильная нижняя навигация */}
      <nav className="bottom-nav" aria-label={t("Навигация")}>
        <NavLink to="/" end className="bn-item"><span className="bn-ico"><Icon name="dashboard" size={19} /></span>{t("Панель")}</NavLink>
        <NavLink to="/spools" className="bn-item"><span className="bn-ico"><Icon name="spool" size={19} /></span>{t("Катушки")}</NavLink>
        <NavLink to="/printers" className="bn-item"><span className="bn-ico"><Icon name="printer" size={19} /></span>{t("Принтеры")}</NavLink>
        <NavLink to="/print-jobs" className="bn-item"><span className="bn-ico"><Icon name="history" size={19} /></span>{t("История")}</NavLink>
        <button className={`bn-item bn-more ${moreOpen ? "active" : ""}`} onClick={() => setMoreOpen(true)}>
          <span className="bn-ico"><Icon name="menu" size={19} /></span>{t("Ещё")}
        </button>
      </nav>

      {/* Шторка «Ещё» — вторичные разделы и действия */}
      {moreOpen && (
        <div className="sheet-backdrop" onClick={closeMore}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("Ещё")}>
            <div className="sheet-handle" />
            <div className="sheet-links">
              <NavLink to="/settings" onClick={closeMore}><Icon name="settings" size={18} />{t("Настройки")}</NavLink>
              <NavLink to="/cost" onClick={closeMore}><Icon name="tag" size={18} />{t("Расчёт стоимости")}</NavLink>
              <NavLink to="/profiles" onClick={closeMore}><Icon name="layers" size={18} />{t("Профили пластика")}</NavLink>
              <NavLink to="/locations" onClick={closeMore}><Icon name="box" size={18} />{t("Места хранения")}</NavLink>
              <NavLink to="/gcode" onClick={closeMore}><Icon name="file" size={18} />{t("Загрузка gcode")}</NavLink>
            </div>
            <div className="sheet-footer">
              <div className="sheet-footer-row">
                <LangSwitch />
                <button className="secondary" onClick={doLogout}>{t("Выйти")}</button>
              </div>
              {user?.email && <div className="muted sheet-email">{user.email}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  // Настройки порога «катушка заканчивается» живут на сервере. Тянем один раз
  // после входа: они нужны в списках, карточках и выборе катушки, а меняются
  // редко. До ответа действуют значения по умолчанию (10 %, 50–200 г).
  useEffect(() => {
    if (!user) return;
    api.get("/api/settings").then(setLowConfig).catch(() => {});
  }, [user?.id]);
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
        <Route path="/cost" element={<CostEstimate />} />
        <Route path="/cost/:id" element={<CostEstimate />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
