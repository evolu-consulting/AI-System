// V2-I · DT-07 · intake Q8 · "Tìm trên internet": chỉ chạy khi người dùng bấm (nút ở đầu trang chi tiết); máy chủ chỉ gửi tên + MST
// cho AI có tìm web qua gói. Kết quả là vài dòng chữ thuần; mỗi dòng có "Lưu vào ghi chú" (nguồn `internet`).
import type { PartnerWebLine } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { toast } from "~/components/shared/toast";
import { addNote, partnerKeys, searchInternet } from "../api";
import { noteOfLine } from "../lib/partner-v2";

/** Mã lỗi của máy chủ (`AGENT_UNAVAILABLE` 503 · `AI_CAP_EXCEEDED` 429) ⇒ khoá câu báo; còn lại ⇒ chung. */
export const searchErrorKey = (e: unknown): "unavailable" | "cap" | "failed" => {
  const code = e instanceof ApiError ? String(e.code) : "";
  return code === "AGENT_UNAVAILABLE"
    ? "unavailable"
    : code === "AI_CAP_EXCEEDED"
      ? "cap"
      : "failed";
};

export function useInternetSearch(party: string) {
  return useMutation({ mutationFn: () => searchInternet(party) });
}

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
  const qc = useQueryClient();
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const save = useMutation({
    mutationFn: (i: number) =>
      addNote({ party, body: noteOfLine(lines[i] as PartnerWebLine), source: "internet" }),
    onSuccess: async (_n, i) => {
      setSaved((s) => new Set(s).add(i));
      await qc.invalidateQueries({ queryKey: partnerKeys.notes(party) });
      toast(L("saved"));
    },
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
