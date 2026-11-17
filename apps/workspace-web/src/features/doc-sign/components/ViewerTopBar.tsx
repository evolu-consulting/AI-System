// CR-181 · s14 · thanh trên màn xem bản đã ký: ← Quay lại · tiêu đề · ô chọn bản · Tải về. Chỉ xem, không có nút sửa.
import type { SignVersionItemOut } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai/web-kit/ui/kit/select";
import { useTranslation } from "react-i18next";
import { contentPath, versionKey } from "../lib/viewer-model";

export function ViewerTopBar(p: {
  versions: SignVersionItemOut[];
  current: SignVersionItemOut | undefined;
  labelOf: (v: SignVersionItemOut) => string;
  onVersion: (key: string) => void;
  onBack: () => void;
  onDownload: (path: string) => void;
}) {
  const { t } = useTranslation();
  const Back = ICONS.back;
  const Down = ICONS.download;
  return (
    <header className="flex flex-wrap items-center gap-3 border-b bg-card px-3 py-2">
      <Button variant="outline" onClick={p.onBack}>
        <Back className="size-4" aria-hidden />
        {t("contracts.docsign.viewer.back")}
      </Button>
      <h1 className="text-md font-semibold">{t("contracts.docsign.viewer.title")}</h1>
      <div className="w-72 max-w-full">
        <Select value={p.current ? versionKey(p.current) : ""} onValueChange={p.onVersion}>
          <SelectTrigger
            aria-label={t("contracts.docsign.viewer.version")}
            data-testid="viewer-version"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {p.versions.map((v) => (
              <SelectItem key={versionKey(v)} value={versionKey(v)}>
                {p.labelOf(v)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <span className="grow" />
      {p.current && (
        <Button
          variant="outline"
          data-testid="viewer-download"
          data-href={contentPath(p.current)}
          onClick={() => p.current && p.onDownload(contentPath(p.current))}
        >
          <Down className="size-4" aria-hidden />
          {t("contracts.docsign.viewer.download")}
        </Button>
      )}
    </header>
  );
}
