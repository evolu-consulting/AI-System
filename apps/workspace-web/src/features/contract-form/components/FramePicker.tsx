// DOC-ui-list · R30 UI: chọn "Thuộc HĐ nguyên tắc" cho Giao dịch — tìm theo tên/số (không giới hạn 100, mỗi lần lấy 20 khớp), chọn một,
// bỏ chọn được. Gắn thật sau khi lưu (`POST /contracts/:id/attach`).
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchList, listKey } from "~/features/contracts-list/api";

const MAX = 20;
const useDebounced = <T,>(v: T, ms: number): T => {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
};

export function framePickerQuery(q: string): string {
  const u = new URLSearchParams([
    ["doc_type", "framework"],
    ["page", "1"],
    ["page_size", String(MAX)],
  ]);
  const s = q.trim();
  if (s.length >= 2) u.set("q", s);
  return u.toString();
}

export function FramePicker({
  value,
  onChange,
  disabled,
}: {
  value: { id: string; title: string } | null;
  onChange: (v: { id: string; title: string } | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const qs = framePickerQuery(useDebounced(q, 250));
  const list = useQuery({
    queryKey: listKey(qs),
    queryFn: ({ signal }) => fetchList(qs, signal),
    enabled: !value,
    staleTime: 30_000,
  });
  if (value)
    return (
      <div className="flex items-center gap-2 text-[13.5px]" data-testid="frame-picked">
        <span className="font-medium">{value.title}</span>
        <button
          type="button"
          className="text-act hover:underline"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          {t("contracts.doclist.frameClear")}
        </button>
      </div>
    );
  const items = list.data?.items ?? [];
  return (
    <div className="flex flex-col gap-1.5">
      <input
        id="cf-frame"
        type="search"
        className="field"
        value={q}
        disabled={disabled}
        placeholder={t("contracts.doclist.frameSearch")}
        onChange={(e) => setQ(e.target.value)}
      />
      {list.isSuccess && !items.length && (
        <span className="text-[12.5px] text-dim">{t("contracts.doclist.frameNone")}</span>
      )}
      {items.length > 0 && (
        <ul
          className="max-h-44 overflow-auto rounded-md border border-rule bg-panel"
          data-testid="frame-options"
        >
          {items.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-[13.5px] hover:bg-sunk"
                onClick={() => onChange({ id: r.id, title: r.title })}
              >
                {r.title}
                {r.number && <span className="ml-2 text-dim">{r.number}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
