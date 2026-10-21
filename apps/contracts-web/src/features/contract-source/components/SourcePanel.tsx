// gap-a2 #3: khoang "Văn bản gốc" bên phải trang HĐ — chữ AI đã đọc (Markdown thô, giữ xuống dòng); `quote` ⇒ tô sáng + cuộn tới đoạn đó,
// không định vị được (AI diễn đạt lại) ⇒ báo rõ, vẫn hiện toàn văn. `nonce` đổi ⇒ cuộn lại dù cùng trích dẫn.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ErrorLine, Loading } from "~/components/shared/states";
import { fetchSourceText, sourceKey } from "../api";
import { locateQuote, splitHighlight } from "../lib/quote";

export function SourcePanel({
  id,
  quote,
  nonce,
  onClose,
}: {
  id: string;
  quote: string | null;
  nonce: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: sourceKey(id),
    queryFn: ({ signal }) => fetchSourceText(id, signal),
    staleTime: 60_000,
  });
  const range = useMemo(
    () => (quote && q.data ? locateQuote(q.data, quote) : null),
    [quote, q.data],
  );
  const mark = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: cuộn lại mỗi lần bấm (nonce), kể cả cùng trích dẫn
  useEffect(() => {
    if (range) mark.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [range, nonce]);
  const parts = splitHighlight(q.data ?? "", range);
  return (
    <aside
      aria-label={t("contracts.assistant.srcTitle")}
      data-testid="source-panel"
      className="flex max-h-[calc(100dvh-2rem)] flex-col rounded-xl border border-rule bg-panel max-lg:max-h-[60dvh]"
    >
      <div className="flex items-center gap-2 border-b border-rule-soft px-4 py-3">
        <h2 className="text-[15px] font-semibold">{t("contracts.assistant.srcTitle")}</h2>
        <button type="button" className="btn btn-quiet ml-auto" onClick={onClose}>
          {t("contracts.common.close")}
        </button>
      </div>
      {quote && !range && q.data !== undefined && (
        <p role="status" className="border-b border-rule-soft px-4 py-2 text-[12.5px] text-soon">
          {t("contracts.assistant.srcNotFound")}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorLine error={q.error} />
        ) : (
          <div className="whitespace-pre-wrap break-words" data-testid="source-text">
            {parts.before}
            {range && (
              <mark ref={mark} data-testid="source-hit" className="rounded bg-soon-bg px-0.5">
                {parts.hit}
              </mark>
            )}
            {parts.after}
          </div>
        )}
      </div>
    </aside>
  );
}
