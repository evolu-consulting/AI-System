// V2-L · "thử tính" trên dữ liệu thật: `POST /reputation/config/preview` (không ghi) — bao nhiêu đối tác đổi điểm/mức nếu lưu bản nháp.
import type { RepPreviewIn } from "@ai/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepPreview } from "../hooks/use-settings";
import { Panel } from "./controls";

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

export function ImpactBox({ body }: { body: RepPreviewIn | null }) {
  const { t } = useTranslation();
  const key = useDebounced(body ? JSON.stringify(body) : null, 600);
  const q = useRepPreview(key);
  const s = (k: string, o?: Record<string, string | number>) =>
    t(`contracts.settings.impact.${k}`, o);
  if (!body)
    return (
      <Panel title={s("title")}>
        <p className="px-5 py-3 text-caption text-dim">{s("none")}</p>
      </Panel>
    );
  const ch = q.data?.changes ?? [];
  return (
    <Panel title={s("title")} sub={s("sub")}>
      <div className="px-5 py-3 text-caption" aria-live="polite">
        {q.isPending && <span className="text-dim">{s("loading")}</span>}
        {q.isError && <span className="text-late">{s("error")}</span>}
        {q.data &&
          (ch.length === 0 ? (
            <span>{s("same", { n: q.data.total })}</span>
          ) : (
            <span data-testid="impact-count">
              {s("count", { n: ch.length, total: q.data.total })}
            </span>
          ))}
        {ch.slice(0, 5).map((c) => (
          <p key={`${c.party}-${c.role}`} className="mt-1 flex justify-between gap-3">
            <span className="truncate">{c.name}</span>
            <span className="tabular-nums">
              {c.old ?? "—"} → {c.new ?? "—"}
            </span>
          </p>
        ))}
      </div>
    </Panel>
  );
}
