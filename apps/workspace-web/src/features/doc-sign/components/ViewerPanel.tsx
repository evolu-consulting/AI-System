// CR-181 · s14 · khung phải: «Chữ ký trong bản này» (bấm ⇒ nhảy tới + viền vàng) và «Chỗ ký còn chờ».
import type { SignFieldOut, SignPart, SignVersionMarkOut } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { useTranslation } from "react-i18next";
import { jumpTarget, placementKey } from "../lib/viewer-model";

export type ViewerJump = { page: number; flash: number[]; parts: SignPart[] };

const ROW =
  "h-auto w-full flex-col items-start justify-start gap-0.5 whitespace-normal rounded-md border bg-card p-2 text-left text-sm font-normal text-foreground hover:bg-accent";

export function ViewerPanel(p: {
  marks: SignVersionMarkOut[];
  kind: "internal" | "digital" | null;
  pending: SignFieldOut[];
  atOf: (m: SignVersionMarkOut) => string;
  onJump: (j: ViewerJump) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 p-3" data-testid="viewer-panel">
      <section aria-labelledby="vw-marks" className="flex flex-col gap-2">
        <h2 id="vw-marks" className="text-sm font-semibold">
          {t("contracts.docsign.viewer.panelTitle")}
        </h2>
        {p.marks.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("contracts.docsign.viewer.noMarks")}</p>
        )}
        {p.marks.map((m, i) => {
          const j = jumpTarget(m.parts);
          return (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              // biome-ignore lint/suspicious/noArrayIndexKey: danh sách chỉ đọc, không đổi chỗ
              key={`${m.signer_id}-${i}`}
              data-testid="viewer-mark"
              className={ROW}
              disabled={!j}
              onClick={() => j && p.onJump(j)}
            >
              <span className="font-medium">
                {m.signer_name ?? t("contracts.docsign.viewer.unknownSigner")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t(placementKey(m))} ·{" "}
                {t("contracts.docsign.viewer.pageRange", {
                  pages: m.pages.map((n) => n + 1).join(", "),
                })}
              </span>
              <span className="text-xs text-muted-foreground">
                {p.atOf(m)}
                {p.kind ? ` · ${t(`contracts.docsign.viewer.${p.kind}`)}` : ""}
              </span>
            </Button>
          );
        })}
      </section>
      {p.pending.length > 0 && (
        <section aria-labelledby="vw-pending" className="flex flex-col gap-2">
          <h2 id="vw-pending" className="text-sm font-semibold">
            {t("contracts.docsign.viewer.pendingTitle")}
          </h2>
          {p.pending.map((f) => {
            const j = jumpTarget(f.parts);
            return (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                key={f.id}
                data-testid="viewer-pending"
                className={ROW}
                onClick={() => j && p.onJump(j)}
              >
                <span className="font-medium">
                  {t("contracts.docsign.waiting", { name: f.label })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("contracts.docsign.viewer.pageRange", {
                    pages: f.parts.map((x) => x.page + 1).join(", "),
                  })}
                </span>
              </Button>
            );
          })}
        </section>
      )}
    </div>
  );
}
