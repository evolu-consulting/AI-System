// CR-194 · tệp văn bản thuần: chỉ chèn text node (React escape) trong <pre> ⇒ không có đường XSS. ≤ 1 MB đầu; lớn hơn ⇒ ghi chú.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readTextHead } from "./text-head";

export default function TextPane({ blob, onError }: { blob: Blob; onError: () => void }) {
  const { t } = useTranslation();
  const [r, setR] = useState<{ text: string; truncated: boolean } | null>(null);
  useEffect(() => {
    let dead = false;
    readTextHead(blob)
      .then((x) => !dead && setR(x))
      .catch(() => !dead && onError());
    return () => {
      dead = true;
    };
  }, [blob, onError]);
  if (!r) return <p className="p-2 text-label text-dim">{t("contracts.fview.loading")}</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="text-viewer">
      {r.truncated && (
        <p className="m-0 text-caption text-dim" data-testid="text-truncated">
          {t("contracts.fview.textTruncated")}
        </p>
      )}
      <pre
        className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border border-rule bg-sunk p-3 font-mono text-sm"
        data-testid="text-content"
      >
        {r.text}
      </pre>
    </div>
  );
}
