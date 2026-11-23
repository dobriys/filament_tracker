// Каркас приложения: боковое меню на широком экране, верхняя полоса и нижняя
// панель на узком. Собран из компонентов Untitled UI.
import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Button as AriaButton, Dialog, Modal, ModalOverlay } from "react-aria-components";
import {
  Calculator, ClockRewind, Disc01, FileCode01, Grid01, LayersTwo01, LogOut01,
  MarkerPin01, Menu01, Moon01, Printer, Settings01, Sun,
} from "@untitledui/icons";
import { NavItemBase } from "@/components/application/app-navigation/base-components/nav-item";
import { Avatar } from "@/components/base/avatar/avatar";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { cx } from "@/utils/cx";
import { useAuth } from "../../api/auth.jsx";
import { api } from "../../api/client.js";
import { getLang, setLang, t } from "../../i18n.js";
import { getTheme, setTheme } from "../../theme.js";

const MAIN_NAV = () => [
  { label: t("Панель"), href: "/", icon: Grid01, end: true },
  { label: t("Катушки"), href: "/spools", icon: Disc01 },
  { label: t("Принтеры"), href: "/printers", icon: Printer },
  { label: t("История"), href: "/print-jobs", icon: ClockRewind },
];
const REF_NAV = () => [
  { label: t("Профили пластика"), href: "/profiles", icon: LayersTwo01 },
  { label: t("Места хранения"), href: "/locations", icon: MarkerPin01 },
  { label: t("Расчёт стоимости"), href: "/cost", icon: Calculator },
  { label: t("Загрузка gcode"), href: "/gcode", icon: FileCode01 },
];
const SETTINGS = () => ({ label: t("Настройки"), href: "/settings", icon: Settings01 });

const isCurrent = (pathname, item) =>
  item.end ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");

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
    <ButtonUtility
      size="sm"
      color="secondary"
      icon={theme === "dark" ? Sun : Moon01}
      tooltip={next === "dark" ? t("Тёмная тема") : t("Светлая тема")}
      onClick={toggle}
    />
  );
}

export function LangSwitch() {
  const lang = getLang();
  return (
    <div className="inline-flex overflow-hidden rounded-lg bg-primary shadow-xs ring-1 ring-primary ring-inset">
      {["ru", "en"].map((l) => (
        <AriaButton
          key={l}
          onPress={() => setLang(l)}
          aria-pressed={l === lang}
          className={cx(
            "h-8 cursor-pointer px-3 text-sm font-semibold outline-focus-ring transition duration-100 ease-linear focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2",
            l === lang ? "bg-secondary text-secondary_hover" : "bg-primary text-secondary hover:bg-primary_hover",
          )}
        >
          {l.toUpperCase()}
        </AriaButton>
      ))}
    </div>
  );
}

function Brand({ compact = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-solid text-white shadow-xs">
        <Disc01 className="size-[18px]" aria-hidden="true" />
      </span>
      <span className={cx("font-semibold text-primary", compact ? "text-md" : "text-lg")}>Filament Tracker</span>
    </div>
  );
}

function NavGroup({ label, items, pathname, onNavigate }) {
  return (
    <div>
      <p className="px-3 pb-1.5 text-xs font-medium text-quaternary">{label}</p>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <li key={item.href}>
            <NavItemBase type="link" icon={item.icon} href={item.href} current={isCurrent(pathname, item)} onClick={onNavigate}>
              {item.label}
            </NavItemBase>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Account({ onLogout }) {
  const { user } = useAuth();
  const email = user?.email || "";
  return (
    <div className="flex items-center gap-3">
      <Avatar size="md" initials={(email[0] || "?").toUpperCase()} />
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-secondary">{email}</p>
      <ButtonUtility size="sm" color="tertiary" icon={LogOut01} tooltip={t("Выйти")} onClick={onLogout} />
    </div>
  );
}

function SidebarBody({ pathname, onLogout }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-6">
        <Brand />
      </div>
      <nav className="mt-6 flex flex-col gap-6 overflow-y-auto px-3" aria-label={t("Навигация")}>
        <NavGroup label={t("Инвентарь")} items={MAIN_NAV()} pathname={pathname} />
        <NavGroup label={t("Справочники")} items={REF_NAV()} pathname={pathname} />
      </nav>
      <div className="mt-auto flex flex-col gap-4 px-3 pt-6 pb-4">
        <NavItemBase type="link" icon={SETTINGS().icon} href={SETTINGS().href} current={isCurrent(pathname, SETTINGS())}>
          {SETTINGS().label}
        </NavItemBase>
        <div className="flex items-center gap-2 border-t border-secondary px-1 pt-4">
          <LangSwitch />
          <ThemeToggle />
        </div>
        <div className="px-1">
          <Account onLogout={onLogout} />
        </div>
      </div>
    </div>
  );
}

const TAB_CLS = ({ isActive }) =>
  cx(
    "flex min-w-0 flex-col items-center gap-1 px-1 pt-2.5 pb-2 text-xs font-medium outline-focus-ring focus-visible:outline-2 focus-visible:-outline-offset-2",
    isActive ? "text-brand-secondary" : "text-quaternary",
  );

export default function AppShell({ children }) {
  const { pathname } = useLocation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const doLogout = () => {
    setMoreOpen(false);
    logout();
    navigate("/login");
  };
  const close = () => setMoreOpen(false);

  return (
    <div className="flex min-h-screen bg-secondary text-primary">
      {/* Боковое меню: от 1024 пикселей */}
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 border-r border-secondary bg-primary lg:block">
        <SidebarBody pathname={pathname} onLogout={doLogout} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Верхняя полоса на узком экране */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-secondary bg-primary px-4 lg:hidden">
          <Brand compact />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <ButtonUtility size="sm" color="secondary" icon={Menu01} tooltip={t("Меню")} onClick={() => setMoreOpen(true)} />
          </div>
        </header>

        <main className="shell-center w-full max-w-[1280px] flex-1 px-4 pt-6 pb-28 lg:px-8 lg:pt-8 lg:pb-12">{children}</main>
      </div>

      {/* Нижняя панель на узком экране */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-secondary bg-primary pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label={t("Навигация")}
      >
        {MAIN_NAV().map((item) => (
          <NavLink key={item.href} to={item.href} end={item.end} className={TAB_CLS}>
            <item.icon className="size-5" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
        <AriaButton onPress={() => setMoreOpen(true)} className={TAB_CLS({ isActive: moreOpen }) + " cursor-pointer bg-transparent"}>
          <Menu01 className="size-5" aria-hidden="true" />
          <span>{t("Ещё")}</span>
        </AriaButton>
      </nav>

      {/* Шторка «Ещё»: вторичные разделы, язык и выход */}
      <ModalOverlay
        isDismissable
        isOpen={moreOpen}
        onOpenChange={setMoreOpen}
        className="fixed inset-0 z-50 flex items-end bg-overlay/70 backdrop-blur-[6px] lg:hidden"
      >
        <Modal className="w-full rounded-t-2xl bg-primary shadow-xl outline-hidden">
          <Dialog aria-label={t("Ещё")} className="flex flex-col gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] outline-hidden">
            <div className="mx-auto h-1 w-10 rounded-full bg-quaternary/40" />
            <ul className="flex flex-col gap-0.5">
              {[SETTINGS(), ...REF_NAV()].map((item) => (
                <li key={item.href}>
                  <NavItemBase type="link" icon={item.icon} href={item.href} current={isCurrent(pathname, item)} onClick={close}>
                    {item.label}
                  </NavItemBase>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-secondary pt-4">
              <LangSwitch />
            </div>
            <Account onLogout={doLogout} />
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}
