// CR-105 L4 / CR-184 · chế độ "Danh sách" của quy trình đang chạy (đối chiếu với sơ đồ): CÙNG thứ tự với sơ đồ, node Nếu ghi rõ Đúng ⇒ / Sai ⇒ tới bước nào.
import { useTranslation } from "react-i18next";
import type { CurrentFlow } from "../lib/current-flow";
import { listRows, viewTrigger } from "../lib/flow-view";

export function FlowList({ flow }: { flow: CurrentFlow }) {
  const { t } = useTranslation();
  const rows = listRows(flow, t);
  const trigger = viewTrigger(flow, t);
  return (
    <ol className="mb-4 flex flex-col gap-2" data-testid="flow-diagram">
      <li
        className="flex flex-col rounded-lg border-2 border-act px-3 py-2"
        data-testid="flow-row-start"
      >
        <span className="font-medium">{trigger.label}</span>
        <span className="text-caption text-dim">{trigger.summary}</span>
      </li>
      {rows.map((r) => (
        <li
          key={r.key}
          data-testid={`flow-row-${r.key}`}
          className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
            r.end ? "border-dashed border-field bg-sunk" : "border-rule"
          }`}
        >
          <span className="min-w-5 text-caption text-dim">{r.index > 0 ? r.index : ""}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">{r.title}</span>
            {r.sub && <span className="text-caption text-dim">{r.sub}</span>}
            {r.branches.map((b) => (
              <span key={b} className="text-caption text-dim" data-testid="flow-row-branch">
                {b}
              </span>
            ))}
          </span>
          {r.badge && (
            <span className="rounded-full bg-act-soft px-2 py-0.5 text-caption font-semibold text-act">
              {r.badge}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
