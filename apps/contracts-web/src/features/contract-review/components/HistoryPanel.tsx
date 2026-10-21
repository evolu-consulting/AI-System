// gap-a1 #4 · "Lịch sử thay đổi": dòng thời gian sự kiện của HĐ (ai · làm gì · lúc nào · khác biệt trường). Dữ liệu theo luật thấy của
// người gọi; chỉ tải khi mở khối.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { useHistory, useMemberNames } from "../hooks/use-manage";
import { type HistoryLine, historyLine } from "../lib/manage";

const when = (iso: string): string => new Date(iso).toLocaleString();

function Line({ h, nameOf }: { h: HistoryLine; nameOf: (id: string | null) => string | null }) {
  const { t } = useTranslation();
  const who = nameOf(h.actor) ?? t("contracts.gapa1.hist.system");
  const owner = h.kind === "owner_assigned";
  const to = owner ? (nameOf(h.to) ?? t("contracts.gapa1.owner.none")) : h.to;
  const from = owner ? (nameOf(h.from) ?? t("contracts.gapa1.owner.none")) : h.from;
  return (
    <li className="border-b border-rule-soft py-2 last:border-0" data-testid="history-line">
      <p className="text-[13.5px]">
        <span className="font-medium">{who}</span>{" "}
        {t(`contracts.gapa1.ev.${h.kind}`, { type: h.type })}
        {h.kind !== "field_edited" && (from !== null || to !== null) && (
          <span className="text-dim">
            {" "}
            ({from ?? "—"} → {to ?? "—"})
          </span>
        )}
      </p>
      <p className="text-[12px] text-dim">{when(h.at)}</p>
      {h.diffs.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[12.5px]">
          {h.diffs.map((d) => (
            <li key={d.key}>
              <span className="text-dim">{d.key}:</span> {d.old || "—"} → {d.new || "—"}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function HistoryPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const q = useHistory(id, open);
  const nameOf = useMemberNames();
  return (
    <Panel className="mt-4">
      <button
        type="button"
        className="flex w-full items-center justify-between px-5 py-3.5 text-left"
        aria-expanded={open}
        data-testid="history-toggle"
        onClick={() => setOpen(!open)}
      >
        <h2 className="text-[15px] font-semibold">{t("contracts.gapa1.hist.title")}</h2>
        <span className="text-sm text-dim">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-5 pb-4" data-testid="history">
          {q.isPending && <p className="text-dim">{t("contracts.gapa1.hist.loading")}</p>}
          {q.isError && <p role="alert">{t("contracts.errors.unknown")}</p>}
          {q.data && q.data.items.length === 0 && (
            <p className="text-dim">{t("contracts.gapa1.hist.empty")}</p>
          )}
          {q.data && (
            <ul>
              {q.data.items.map((h, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: sự kiện không có id trong phản hồi; danh sách chỉ đọc
                <Line key={i} h={historyLine(h)} nameOf={nameOf} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
