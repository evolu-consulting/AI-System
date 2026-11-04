// PK-FR-10 · TF6 · cột người dùng chọn hiện, nhớ trong trình duyệt (storage bị chặn ⇒ hiện hết). Nguồn: table.tsx:287-308.
import { useState } from "react";

export type Column = { key: string; label: string; locked?: boolean };

export function useColumns(storageKey: string, columns: Column[]) {
  const all = columns.map((c) => c.key);
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(`cols:${storageKey}`) ?? "[]");
      return Array.isArray(raw) ? raw.filter((k): k is string => all.includes(k as string)) : [];
    } catch {
      return [];
    }
  });
  const save = (h: string[]) => {
    setHidden(h);
    try {
      localStorage.setItem(`cols:${storageKey}`, JSON.stringify(h));
    } catch {
      /* không lưu được */
    }
  };
  return {
    columns,
    shows: (key: string) => !hidden.includes(key),
    toggle: (key: string) =>
      save(hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]),
    reset: () => save([]),
    hiddenCount: hidden.length,
  };
}

export type Columns = ReturnType<typeof useColumns>;
