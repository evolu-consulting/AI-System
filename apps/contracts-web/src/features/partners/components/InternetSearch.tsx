// V2-I · DT-07 · intake Q8 · "Tìm trên internet": chỉ chạy khi người dùng bấm (nút ở đầu trang chi tiết); máy chủ chỉ gửi tên + MST
// cho AI có tìm web qua gói. Kết quả là vài dòng chữ thuần; mỗi dòng có "Lưu vào ghi chú" (nguồn `internet`).
import type { PartnerWebLine } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { toast } from "~/components/shared/toast";
import { useSaveWebLine } from "../hooks/use-partner-rep";

export function InternetResult({
  party,
  lines,
  write,
  onClose,
}: {
  party: string;
  lines: PartnerWebLine[];
  write: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.pv2.web.${k}`);
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const save = useSaveWebLine(party, lines, {
    onDone: (i) => setSaved((s) => new Set(s).add(i)),
    onSaved: () => toast(L("saved")),
  });
  return (
    <Panel>
      <div className="flex items-center gap-2 border-b border-rule-soft px-5 py-3">
        <h3 className="text-[15px] font-semibold">{L("title")}</h3>
        <span className="text-[12.5px] text-dim">{L("hint")}</span>
        <button
          type="button"
          className="btn btn-quiet ml-auto h-8 px-2"
          aria-label={L("close")}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {lines.length === 0 ? (
        <p className="px-5 py-4 text-label text-dim">{L("none")}</p>
      ) : (
        <ul>
          {lines.map((l, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: dòng kết quả không có id; danh sách cố định trong một lượt
              key={i}
              className="flex items-start gap-3 border-b border-rule-soft px-5 py-3 last:border-0"
            >
              <span className="min-w-0 flex-1">
                <b className="block">{l.title}</b>
                {l.summary && <span className="block text-[13.5px] text-ink-2">{l.summary}</span>}
                {l.source && <span className="block text-[12px] text-dim">{l.source}</span>}
              </span>
              {write && (
                <button
                  type="button"
                  className="btn btn-quiet h-8 shrink-0 text-[13px]"
                  disabled={saved.has(i) || save.isPending}
                  onClick={() => save.mutate(i)}
                >
                  {saved.has(i) ? L("savedShort") : L("save")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {save.isError && (
        <p role="alert" className="px-5 pb-3 text-[12.5px] text-late">
          {t("contracts.errors.unknown")}
        </p>
      )}
    </Panel>
  );
}
