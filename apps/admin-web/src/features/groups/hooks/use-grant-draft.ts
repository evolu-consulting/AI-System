// ADM-FR-32 · M3-R08 · nháp tick của chế độ Sửa (tab Feature): tập id feature đang tick, kế hoạch batch so với bản đã lưu.
import { useMemo, useState } from "react";
import { type GrantRow, planBatch } from "../lib/grants";

export function useGrantDraft(rows: GrantRow[], groupId: string) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const plan = useMemo(() => planBatch(rows, selected, groupId), [rows, selected, groupId]);

  const start = () => {
    setSelected(new Set(rows.filter((r) => r.granted).map((r) => r.id)));
    setEditing(true);
  };
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return {
    editing,
    selected,
    plan,
    dirty: plan.add.length + plan.remove.length > 0,
    start,
    toggle,
    close: () => setEditing(false),
  };
}
