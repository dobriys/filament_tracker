// Общие блоки страниц трекера на основе Untitled UI.
// Здесь живут повторы «платных» компонентов библиотеки (шапка страницы,
// плитка показателя, хлебные крошки, карточка): их нет в бесплатном наборе,
// поэтому они написаны вручную в том же стиле и на тех же токенах.
import { Breadcrumb, Breadcrumbs, Link as AriaLink } from "react-aria-components";
import { ChevronRight } from "@untitledui/icons";
import { BadgeWithDot } from "@/components/base/badges/badges";
import { cx } from "@/utils/cx";
import { t } from "../../i18n.js";

/** Хлебные крошки: [{ label, href }], у последнего href не нужен. */
export function FtBreadcrumbs({ items, className }) {
  return (
    <Breadcrumbs className={cx("flex flex-wrap items-center gap-1.5 text-sm font-semibold", className)}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <Breadcrumb key={i} className="flex items-center gap-1.5">
            {last || !it.href ? (
              <span aria-current={last ? "page" : undefined} className={last ? "text-brand-secondary" : "text-tertiary"}>
                {it.label}
              </span>
            ) : (
              <AriaLink href={it.href} className="rounded-sm text-tertiary outline-focus-ring hover:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2">
                {it.label}
              </AriaLink>
            )}
            {!last && <ChevronRight className="size-4 text-fg-quaternary" aria-hidden="true" />}
          </Breadcrumb>
        );
      })}
    </Breadcrumbs>
  );
}

/** Шапка страницы: заголовок, пояснение, значок рядом и действия справа. */
export function PageHeader({ title, subtitle, badge, actions, breadcrumbs, leading, className }) {
  return (
    <div className={cx("mb-6 flex flex-col gap-4 lg:mb-8", className)}>
      {breadcrumbs && <FtBreadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {leading}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="m-0 text-display-xs font-semibold text-primary lg:text-display-sm">{title}</h1>
              {badge}
            </div>
            {subtitle && <div className="mt-1 text-md text-tertiary">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </div>
  );
}

/** Карточка: белая плоскость с тонким кольцом вместо рамки. */
export function Card({ children, className, ...rest }) {
  return (
    <div {...rest} className={cx("rounded-xl bg-primary shadow-xs ring-1 ring-secondary", className)}>
      {children}
    </div>
  );
}

/** Шапка карточки: заголовок, пояснение, значок и действия. */
export function CardHeader({ title, description, badge, actions, className }) {
  return (
    <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-secondary px-5 py-4", className)}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 text-md font-semibold text-primary">{title}</h3>
          {badge}
        </div>
        {description && <p className="mt-0.5 text-sm text-tertiary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Плитка показателя: подпись, крупное число и пояснение. */
export function MetricCard({ label, value, hint, tone }) {
  return (
    <Card className="flex flex-col gap-2 p-5">
      <div className="text-sm font-medium text-tertiary">{label}</div>
      <div className="text-display-sm font-semibold tracking-tight text-primary tabular-nums">{value}</div>
      {hint != null && (
        <div className={cx("text-sm", tone === "warning" ? "font-medium text-warning-primary" : "text-tertiary")}>{hint}</div>
      )}
    </Card>
  );
}

/** Цветной квадрат катушки: цвет самого филамента, единственный цвет на экране. */
export function SpoolSwatch({ color, size = "md", className }) {
  const dim = { sm: "size-6 rounded-md", md: "size-8 rounded-lg", lg: "size-14 rounded-xl" }[size];
  return (
    <span
      aria-hidden="true"
      className={cx("inline-block shrink-0 ring-1 ring-black/10 ring-inset dark:ring-white/25", dim, className)}
      style={{ background: color || "var(--color-bg-quaternary)" }}
    />
  );
}

/** Остаток катушки: граммы, полоса цвета катушки и проценты. */
export function RemainingBar({ grams, pct, color, className, compact = false }) {
  const p = Math.round(pct * 100);
  return (
    <div className={cx("flex items-center gap-3", className)}>
      <span className={cx("text-sm font-medium whitespace-nowrap text-primary tabular-nums", compact ? "min-w-12" : "min-w-14")}>
        {grams} {t("г")}
      </span>
      <div className="h-2 min-w-12 flex-1 overflow-hidden rounded-full bg-quaternary">
        <div className="h-full rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/25" style={{ width: `${Math.max(p, p > 0 ? 3 : 0)}%`, background: color }} />
      </div>
      <span className="w-9 text-right text-sm text-tertiary tabular-nums">{p}%</span>
    </div>
  );
}

const STATUS_COLOR = { new: "gray", in_use: "brand", almost_empty: "warning", empty: "error", archived: "gray" };

/** Статус катушки значком с точкой: цвет подсказывает смысл. */
export function SpoolStatusBadge({ status, label }) {
  return (
    <BadgeWithDot type="pill-color" size="sm" color={STATUS_COLOR[status] || "gray"}>
      {label}
    </BadgeWithDot>
  );
}

/** Пустое состояние внутри карточки. */
export function EmptyNote({ children }) {
  return <div className="px-6 py-10 text-center text-sm text-tertiary">{children}</div>;
}

/** Блок характеристик: малая подпись и строки «название — значение». */
export function SpecGroup({ title, children }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-semibold tracking-wide text-quaternary uppercase">{title}</p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

/** Одна строка характеристики: название слева, значение справа. */
export function SpecRow({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-secondary py-2 text-sm last:border-b-0">
      <span className="text-tertiary">{label}</span>
      <span className="text-right font-medium text-primary tabular-nums">{children}</span>
    </div>
  );
}

/** Заглушка, пока страница загружает данные. */
export function PageLoading() {
  return <div className="py-16 text-center text-sm text-tertiary">{t("Загрузка…")}</div>;
}
