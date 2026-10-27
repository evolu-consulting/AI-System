// REP-v3-ui · màn xem trước cho quản lý: "N đối tác đổi mức nếu chuyển sang điểm vai × nhóm SP (V2-E)" — `GET /reputation/switch-preview`.
// CHỈ ĐỌC (máy chủ không ghi gì). Bật/tắt engine là cờ `REPUTATION_ENGINE` do quản trị hệ thống đặt, không làm trên màn hình này.
import type { RepLevel } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { useSwitchPreview } from "~/features/partners/hooks/use-rep-v2e";
import { Panel } from "./controls";

export function SwitchPreview({ engine }: { engine: "hd8" | "v2e" }) {
  const { t } = useTranslation();
  const s = (k: string, o?: Record<string, unknown>) => t(`contracts.rep3.preview.${k}`, o);
  const lvl = (l: RepLevel) => t(`contracts.rep3.level.${l}`);
  const q = useSwitchPreview(true);
  const p = q.data;
  return (
    <Panel title={s("title")} sub={s(engine === "hd8" ? "subHd8" : "subV2e")}>
      <div className="px-5 py-3 text-label" data-testid="switch-preview" aria-live="polite">
        {q.isLoading ? (
          <span className="text-dim">{s("loading")}</span>
        ) : q.error || !p ? (
          <span className="text-late">{s("fail")}</span>
        ) : (
          <>
            <b data-testid="switch-count">
              {s("count", { changed: p.changed, partners: p.partners, total: p.total })}
            </b>
            {p.moves.length > 0 && (
              <ul className="mt-2 space-y-1 text-caption text-dim" data-testid="switch-moves">
                {p.moves.map((m) => (
                  <li key={`${m.from}>${m.to}`}>
                    {lvl(m.from)} → {lvl(m.to)}: {m.n}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className="mt-2 text-caption text-dim" data-testid="switch-note">
          {s("note")}
        </p>
      </div>
    </Panel>
  );
}
