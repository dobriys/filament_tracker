// Куски форм, общие для катушки и профиля филамента.
import { Button as AriaButton } from "react-aria-components";
import { Check } from "@untitledui/icons";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { cx } from "@/utils/cx";

// Select не принимает пустую строку в роли id, поэтому «не выбрано» — условный ключ.
export const NONE = "__none";

/** Простые значения → пункты списка [{ id, label }]. */
export const plain = (list) => list.map((v) => ({ id: v, label: v }));

/** Выпадающий список из набора [{ id, label }]; onChange получает id строкой. */
export function Pick({ label, value, onChange, items, ...rest }) {
  return (
    <Select size="sm" label={label} items={items} selectedKey={value} onSelectionChange={(k) => onChange(String(k))} {...rest}>
      {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
    </Select>
  );
}

/** Цвет: выбор из палитры и тот же код цветом текстом (#rrggbb). */
export function ColorField({ label, value, onChange }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-secondary">{label}</p>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border-0 bg-primary p-1 shadow-xs ring-1 ring-primary ring-inset"
        />
        <Input size="sm" aria-label={label} value={value} onChange={onChange} />
      </div>
    </div>
  );
}

/** Выбор нескольких значений плашками. */
export function ChipSelect({ label, options, selected, onToggle }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-secondary">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const on = Array.isArray(selected) && selected.includes(opt);
          return (
            <AriaButton
              key={opt}
              onPress={() => onToggle(opt)}
              aria-pressed={on}
              className={cx(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset outline-focus-ring transition duration-100 ease-linear focus-visible:outline-2 focus-visible:outline-offset-2",
                on
                  ? "bg-utility-brand-50 text-utility-brand-700 ring-utility-brand-200"
                  : "bg-primary text-secondary ring-primary hover:bg-primary_hover",
              )}
            >
              {on && <Check className="size-4" aria-hidden="true" />}
              {opt}
            </AriaButton>
          );
        })}
      </div>
    </div>
  );
}

/** Малая подпись раздела формы: «ТЕМПЕРАТУРЫ». */
export function SectionLabel({ children, className }) {
  return <p className={cx("mb-3 text-xs font-semibold tracking-wide text-quaternary uppercase", className)}>{children}</p>;
}

/**
 * Расширенные характеристики филамента по группам (схема в specFields.js).
 * specs — текущие значения, setSpec(key) → onChange поля, toggleMulti(key, opt) — плашка.
 */
export function SpecGroupsForm({ groups, specs, setSpec, toggleMulti }) {
  return (
    <div className="flex flex-col gap-8">
      {groups.map((g) => (
        <section key={g.title}>
          <SectionLabel>{g.title}</SectionLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {g.fields.filter((f) => f.type !== "multiselect").map((f) => (
              <Input
                key={f.key}
                size="sm"
                type={f.type}
                label={`${f.label}${f.unit ? `, ${f.unit}` : ""}`}
                value={String(specs?.[f.key] ?? "")}
                onChange={setSpec(f.key)}
                placeholder={f.placeholder || ""}
              />
            ))}
          </div>
          {g.fields.filter((f) => f.type === "multiselect").map((f) => (
            <div key={f.key} className="mt-4">
              <ChipSelect label={f.label} options={f.options} selected={specs?.[f.key]} onToggle={(opt) => toggleMulti(f.key, opt)} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
