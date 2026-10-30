// CR-105 · L3 · B3: "Xem trước đường đi" — nhập loại HĐ + giá trị mẫu ⇒ Hub (thuần, không ghi) trả bước chạy / bỏ qua.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { processErrorSpec } from "../../lib/errors";
import { DEALS } from "../../lib/flow-when";
import { normalizePreview, parseSampleValue } from "../../lib/library-view";
import type { DealKind, LibraryDef, PreviewStep } from "../../library-api";
import { usePreview } from "../../library-api";
import { SelectField, TextField } from "../editor/Fields";

type Props = { def: LibraryDef; open: boolean; onClose: () => void };

export function PreviewDialog({ def, open, onClose }: Props) {
  const { t } = useTranslation();
  const preview = usePreview(def.id);
  const [deal, setDeal] = useState<DealKind>("buy");
  const [raw, setRaw] = useState("");
  const [path, setPath] = useState<PreviewStep[] | null>(null);
  const value = parseSampleValue(raw);
  const run = async () => {
    if (value === "invalid") return;
    try {
      setPath(normalizePreview(await preview.mutateAsync({ deal, total_value: value })));
    } catch (err) {
      const s = processErrorSpec(err);
      notifyError(t(s.key, s.params));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("process.admin.library.preview.title", { name: def.name })}</DialogTitle>
          <DialogDescription>{t("process.admin.library.preview.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            id="preview-deal"
            label={t("process.admin.library.form.dealKind")}
            value={deal}
            options={DEALS.map((d) => ({
              value: d,
              label: t(`process.admin.library.form.deal.${d}`),
            }))}
            onChange={(d) => setDeal(d as DealKind)}
          />
          <TextField
            id="preview-value"
            label={t("process.admin.library.preview.value")}
            value={raw}
            placeholder={t("process.admin.library.preview.valueHint")}
            error={
              value === "invalid" ? t("process.admin.library.preview.valueInvalid") : undefined
            }
            onChange={setRaw}
          />
        </div>
        <Button
          className="self-start"
          disabled={preview.isPending || value === "invalid"}
          onClick={() => void run()}
        >
          {t("process.admin.library.preview.run")}
        </Button>
        {path ? (
          <ol
            className="space-y-1"
            data-testid="preview-path"
            aria-label={t("process.admin.library.preview.result")}
          >
            {path.map((s, i) => (
              <li
                key={s.key || i}
                data-run={s.run}
                className={s.run ? "text-body" : "text-body text-muted-foreground line-through"}
              >
                {i + 1}. {s.name} —{" "}
                {t(
                  s.run
                    ? "process.admin.library.preview.runs"
                    : "process.admin.library.preview.skipped",
                )}
              </li>
            ))}
          </ol>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
