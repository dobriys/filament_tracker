import { useEffect, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { ChevronRight, Edit01, Package, Trash01 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Input } from "@/components/base/input/input";
import { Card, PageHeader } from "../components/ft/ui.jsx";
import { NONE, Pick } from "../components/ft/form.jsx";
import { Notice } from "../components/ft/printer.jsx";
import { cx } from "@/utils/cx";
import { api } from "../api/client.js";
import { t } from "../i18n.js";
import EnvSensor, { useEnvSensors } from "../components/EnvSensor.jsx";
import { buildTree, flattenTree, descendantIds, locationPath } from "../utils/locations.js";

// «N внутри» с русским склонением — родитель показывает, что в нём что-то есть.
function insideLabel(n) {
  const mod10 = n % 10, mod100 = n % 100;
  let word = t("мест");
  if (mod10 === 1 && mod100 !== 11) word = t("место");
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) word = t("места");
  return `${n} ${word}`;
}

export default function Locations() {
  const [locations, setLocations] = useState([]);
  const [error, setError] = useState(null);
  // Форма добавления и инлайн-правка держат раздельные состояния — иначе правка
  // «протекает» в поля добавления (одни и те же значения на две формы).
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editParent, setEditParent] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [collapsed, setCollapsed] = useState(new Set());
  const { sensors, humidity_alert_max_pct: humidityMax } = useEnvSensors();
  const sensorFor = (locationId) =>
    sensors.find((s) => s.bind_type === "location" && s.bind_id === locationId);

  const tree = buildTree(locations);
  const flat = flattenTree(locations); // для списков «Внутри» (в порядке дерева)
  const childCount = (id) => locations.filter((l) => l.parent_id === id).length;
  const blocked = editId ? descendantIds(locations, editId) : new Set();
  const editParentOptions = flat.filter((l) => l.id !== editId && !blocked.has(l.id));

  // Пункты «Внутри»: верхний уровень и полный путь до каждого места.
  const parentItems = (list) => [
    { id: NONE, label: t("— Верхний уровень") },
    ...list.map((l) => ({ id: l.id, label: locationPath(locations, l.id) })),
  ];

  function load() {
    api.get("/api/locations").then(setLocations).catch(() => {});
  }
  useEffect(load, []);

  function toggle(id) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function create(e) {
    e.preventDefault();
    if (!name) return;
    setError(null);
    try {
      await api.post("/api/locations", { name, parent_id: parentId || null, description: description || null });
    } catch (err) {
      setError(err?.message || t("Не удалось сохранить"));
      return;
    }
    setName("");
    setParentId("");
    setDescription("");
    load();
  }

  function startEdit(l) {
    setEditId(l.id);
    setEditName(l.name);
    setEditParent(l.parent_id || "");
    setEditDesc(l.description || "");
  }
  function cancelEdit() {
    setEditId(null);
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editName) return;
    setError(null);
    try {
      await api.patch(`/api/locations/${editId}`, {
        name: editName,
        parent_id: editParent || null,
        description: editDesc || null,
      });
    } catch (err) {
      setError(err?.message || t("Не удалось сохранить"));
      return;
    }
    setEditId(null);
    load();
  }

  async function remove(id) {
    setError(null);
    if (childCount(id) > 0) {
      setError(t("Нельзя удалить место, у которого есть вложенные — сначала уберите их"));
      return;
    }
    try {
      await api.del(`/api/locations/${id}`);
    } catch (err) {
      setError(err?.message || t("Не удалось удалить"));
    }
    if (editId === id) setEditId(null);
    load();
  }

  function renderNode(node) {
    const kids = node.children.length;
    const open = !collapsed.has(node.id);
    const sensor = sensorFor(node.id);
    const editing = editId === node.id;
    return (
      <li key={node.id}>
        {editing ? (
          <form onSubmit={saveEdit} className="my-1 rounded-lg bg-secondary_alt p-3 ring-1 ring-secondary ring-inset">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input size="sm" autoFocus label={t("Название")} value={editName} onChange={setEditName} />
              <Pick
                label={t("Внутри")}
                value={editParent || NONE}
                onChange={(k) => setEditParent(k === NONE ? "" : k)}
                items={parentItems(editParentOptions)}
              />
              <Input size="sm" label={t("Описание")} value={editDesc} onChange={setEditDesc} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button type="submit" size="sm">{t("Сохранить")}</Button>
              <Button size="sm" color="secondary" onClick={cancelEdit}>{t("Отменить")}</Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-primary_hover">
            {kids > 0 ? (
              <AriaButton
                onPress={() => toggle(node.id)}
                aria-label={open ? t("Свернуть") : t("Развернуть")}
                aria-expanded={open}
                className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md bg-transparent text-fg-quaternary outline-focus-ring hover:text-fg-quaternary_hover focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <ChevronRight className={cx("size-4 transition duration-100 ease-linear", open && "rotate-90")} aria-hidden="true" />
              </AriaButton>
            ) : (
              <span className="size-7 shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-primary">{node.name}</span>
                {kids > 0 && <Badge size="sm" color="gray" type="pill-color">{insideLabel(kids)}</Badge>}
              </div>
              {(node.description || sensor) && (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-tertiary">
                  {node.description && <span>{node.description}</span>}
                  {sensor && <EnvSensor sensor={sensor} threshold={humidityMax} showName={false} inline />}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ButtonUtility size="sm" color="tertiary" icon={Edit01} tooltip={t("Изменить")} onClick={() => startEdit(node)} />
              <ButtonUtility
                size="sm"
                color="tertiary"
                icon={Trash01}
                isDisabled={kids > 0}
                tooltip={kids > 0 ? t("Нельзя удалить место, у которого есть вложенные — сначала уберите их") : t("Удалить")}
                onClick={() => remove(node.id)}
              />
            </div>
          </div>
        )}
        {kids > 0 && open && <ul className="ml-[22px] border-l border-secondary pl-2">{node.children.map(renderNode)}</ul>}
      </li>
    );
  }

  return (
    <div>
      <PageHeader title={t("Места хранения")} />
      {error && <Notice tone="error" className="mb-6" onClose={() => setError(null)}>{error}</Notice>}

      <Card className="mb-6 p-5">
        <form onSubmit={create} className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
          <Input size="sm" label={t("Название")} value={name} onChange={setName} placeholder={t("Стеллаж, полка, сухобокс…")} />
          <Pick
            label={t("Внутри")}
            value={parentId || NONE}
            onChange={(k) => setParentId(k === NONE ? "" : k)}
            items={parentItems(flat)}
          />
          <Input size="sm" label={t("Описание")} value={description} onChange={setDescription} />
          <Button type="submit" size="md" className="sm:col-span-2 lg:col-span-1">{t("Добавить")}</Button>
        </form>
      </Card>

      <Card className="p-2 sm:p-3">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <Package className="size-8 text-fg-quaternary" aria-hidden="true" />
            <p className="m-0 text-md font-semibold text-primary">{t("Пока нет мест хранения")}</p>
            <p className="m-0 max-w-md text-sm text-tertiary">{t("Добавьте первое — комнату, стеллаж или сухобокс, — а потом вкладывайте полки внутрь.")}</p>
          </div>
        ) : (
          <ul>{tree.map(renderNode)}</ul>
        )}
      </Card>
    </div>
  );
}
