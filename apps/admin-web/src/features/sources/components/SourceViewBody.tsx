// ADM-FR-68 · PB-R21 · chế độ "Xem" (tenant_admin + local_path): CHỈ ký hiệu, loại, mô tả + cảnh báo. KHÔNG nhận/in `path`
// (props không có trường đường dẫn), không nút Lưu / Kiểm tra.
import type { SourceKind } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { LocalPathWarning } from "./LocalPathWarning";

type Props = { sourceKey: string; kind: SourceKind; description: string };

export function SourceViewBody({ sourceKey, kind, description }: Props) {
  const { t } = useTranslation();
  return (
    <dl className="space-y-3 text-body">
      <div>
        <dt className="text-caption text-muted-foreground">{t("process.sources.field.key")}</dt>
        <dd className="font-mono">{sourceKey}</dd>
      </div>
      <div>
        <dt className="text-caption text-muted-foreground">{t("process.sources.field.kind")}</dt>
        <dd>{t(`process.sources.kind.${kind}`)}</dd>
      </div>
      <div>
        <dt className="text-caption text-muted-foreground">{t("process.sources.field.desc")}</dt>
        <dd className="whitespace-pre-wrap">{description}</dd>
      </div>
      {kind === "local_path" ? (
        <>
          <LocalPathWarning />
          <p className="text-caption text-muted-foreground">
            {t("process.sources.view.localNote")}
          </p>
          <p className="text-caption text-muted-foreground">
            {t("process.sources.row.checkForbidden")}
          </p>
        </>
      ) : null}
    </dl>
  );
}
