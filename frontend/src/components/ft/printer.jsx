// Блоки, общие для «Панели» и страницы «Принтеры».
import { Button as AriaButton } from "react-aria-components";
import { AlertCircle, AlertTriangle, CheckCircle, InfoCircle, XClose } from "@untitledui/icons";
import { BadgeWithDot } from "@/components/base/badges/badges";
import { cx } from "@/utils/cx";

const TONES = {
  error: { box: "bg-error-primary ring-utility-red-200 text-error-primary", icon: AlertCircle },
  warning: { box: "bg-warning-primary ring-utility-yellow-200 text-warning-primary", icon: AlertTriangle },
  info: { box: "bg-brand-primary ring-utility-brand-200 text-brand-secondary", icon: InfoCircle },
  success: { box: "bg-success-primary ring-utility-green-200 text-success-primary", icon: CheckCircle },
};

/** Уведомление внутри страницы: тон по смыслу, подробности и действия справа. */
export function Notice({ tone = "info", title, children, actions, onClose, className, icon }) {
  const T = TONES[tone] || TONES.info;
  const Icon = icon || T.icon;
  return (
    <div role={tone === "error" ? "alert" : undefined} className={cx("flex items-start gap-3 rounded-lg p-3 text-sm ring-1 ring-inset", T.box, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title && "mt-0.5", "break-words")}>{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3 font-medium">{actions}</div>}
      {onClose && (
        <AriaButton onPress={onClose} aria-label="×" className="-m-1 shrink-0 cursor-pointer rounded bg-transparent p-1 opacity-70 hover:opacity-100">
          <XClose className="size-4" aria-hidden="true" />
        </AriaButton>
      )}
    </div>
  );
}

const STATE_TONE = { in_use: "brand", added: "success", used: "error", "": "gray" };

/** Состояние принтера значком с точкой. tag — "in_use" | "added" | "used" | "". */
export function StateBadge({ tag, children, size = "sm" }) {
  return (
    <BadgeWithDot type="pill-color" size={size} color={STATE_TONE[tag] || "gray"}>
      {children}
    </BadgeWithDot>
  );
}

/** Малая подпись раздела: «Печатается», «Слоты ACE Pro». */
export function ZoneTitle({ children, className }) {
  return <p className={cx("mb-3 text-xs font-semibold tracking-wide text-quaternary uppercase", className)}>{children}</p>;
}

/** Показатель в рамке: подпись и значение. */
export function Stat({ label, children, className }) {
  return (
    <div className={cx("min-w-0 rounded-lg px-3 py-2 ring-1 ring-secondary ring-inset", className)}>
      <p className="truncate text-xs text-tertiary">{label}</p>
      <p className="mt-0.5 text-sm font-semibold whitespace-nowrap text-primary tabular-nums">{children}</p>
    </div>
  );
}
