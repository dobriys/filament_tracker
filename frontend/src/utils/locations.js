// Помощники для многоуровневых мест хранения (иерархия через parent_id).

// Полный путь до места строкой: «Кабинет → Стеллаж → Полка 1».
export function locationPath(locations, id, sep = " → ") {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const parts = [];
  let cur = byId.get(id);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return parts.join(sep);
}

// id всех потомков места (без самого места) — чтобы не дать вложить узел в себя/потомка.
export function descendantIds(locations, id) {
  const children = new Map();
  for (const l of locations) {
    const key = l.parent_id || null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(l.id);
  }
  const result = new Set();
  const stack = [...(children.get(id) || [])];
  while (stack.length) {
    const cur = stack.pop();
    if (result.has(cur)) continue;
    result.add(cur);
    stack.push(...(children.get(cur) || []));
  }
  return result;
}

// Плоский список в порядке дерева, с глубиной каждого узла (для отступов).
export function flattenTree(locations) {
  const children = new Map();
  for (const l of locations) {
    const key = l.parent_id || null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(l);
  }
  for (const list of children.values())
    list.sort((a, b) => a.name.localeCompare(b.name));
  const known = new Set(locations.map((l) => l.id));
  const out = [];
  const walk = (parentId, depth) => {
    for (const node of children.get(parentId) || []) {
      out.push({ ...node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  // Узлы, чей родитель не найден (осиротевшие), показываем как корневые.
  for (const l of locations)
    if (l.parent_id && !known.has(l.parent_id)) {
      out.push({ ...l, depth: 0 });
      walk(l.id, 1);
    }
  return out;
}
