// CR-188 · BR-188-4 · danh sách phiên bản chữ ký: số bản, ngày tạo, «Đang dùng»; bấm một bản ⇒ xem giấy tờ đã ký bằng nó.
import type { MySignatureHistoryRow } from "@ai/contracts/signature";
import { Badge } from "@ai/web-kit/ui/kit/badge";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { numberVersions } from "../lib/versions";

export function SignatureVersions(p: {
  history: readonly MySignatureHistoryRow[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language === "en" ? "en-GB" : "vi-VN");
  return (
    <ul className="grid gap-1" data-testid="sig-versions">
      {numberVersions(p.history).map((v) => (
        <li key={v.id}>
          <button
            type="button"
            aria-pressed={p.selectedId === v.id}
            onClick={() => p.onSelect?.(v.id)}
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm hover:bg-muted aria-pressed:border-act aria-pressed:bg-muted"
          >
            <span>
              {t("contracts.mySig.versions.item", {
                n: v.number,
                at: day(v.created_at),
              })}
              {v.kind === "initials" ? ` · ${t("contracts.mySig.page.initialsLabel")}` : ""}
            </span>
            {v.current && (
              <Badge icon={<Check size={12} />}>{t("contracts.mySig.versions.current")}</Badge>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
