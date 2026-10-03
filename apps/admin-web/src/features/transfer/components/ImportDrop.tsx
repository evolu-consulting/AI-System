// ADM-FR-54 · M4-R14 · Import bước 1 (ms §8): vùng kéo-thả + nút "Chọn file" (label bọc input file sr-only).
import { Upload } from "lucide-react";
import { type DragEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ImportFileProblem } from "../lib/import-file";

type Props = { problem: ImportFileProblem | null; onPick: (file: File) => void };

export function ImportDrop({ problem, onPick }: Props) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onPick(f);
  };
  return (
    <div className="space-y-2">
      {/* Cả vùng là `label` của input file: bấm hoặc thả file đều được; input giữ tên "Chọn file". */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center focus-within:ring-[3px] focus-within:ring-ring/50",
          over && "border-primary bg-muted",
        )}
      >
        <Upload aria-hidden className="size-6 text-muted-foreground" />
        <span className="text-body text-muted-foreground">{t("transfer.import.drop")}</span>
        <span className="inline-flex h-9 items-center rounded-md border border-border bg-background px-4 text-body font-medium hover:bg-muted">
          {t("transfer.import.choose")}
        </span>
        <input
          type="file"
          accept=".yaml,.yml"
          aria-label={t("transfer.import.choose")}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onPick(f);
          }}
        />
      </label>
      {problem ? (
        <p role="alert" className="text-label text-destructive">
          {t(`transfer.import.${problem}`)}
        </p>
      ) : null}
    </div>
  );
}
