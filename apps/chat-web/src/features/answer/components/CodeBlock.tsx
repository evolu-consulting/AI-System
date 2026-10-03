// C1 FE · F12 · khối code: tô màu hljs (chunk riêng, chỉ khi `highlight`), nút Copy (ADR-0006).
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyText } from "../lib/clipboard";
import { highlightToHtml } from "../lib/highlight";

type Props = { code: string; lang?: string | undefined; highlight: boolean };

export function CodeBlock({ code, lang, highlight }: Props) {
  const { t } = useTranslation();
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = codeRef.current;
    if (!el || !highlight) return;
    let alive = true;
    void highlightToHtml(code, lang).then((html) => {
      // Ngoại lệ innerHTML có điều kiện (ADR-0006 "Cách dùng"): hljs đã escape toàn bộ văn bản, chỉ sinh <span class=hljs-*>.
      if (alive && html !== null) el.innerHTML = html;
    });
    return () => {
      alive = false;
    };
  }, [code, lang, highlight]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between bg-muted px-3 py-1 text-xs text-muted-strong-foreground">
        <span className="font-mono">{lang ?? ""}</span>
        <button
          type="button"
          aria-label={t("answer.copy")}
          onClick={async () => setCopied(await copyText(code))}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          <span aria-live="polite">{copied ? t("answer.copied") : t("answer.copy")}</span>
        </button>
      </div>
      <pre className="hljs overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code ref={codeRef} className="font-mono">
          {code}
        </code>
      </pre>
    </div>
  );
}
