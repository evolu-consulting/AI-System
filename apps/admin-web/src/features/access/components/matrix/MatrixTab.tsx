// ADM-FR-35 · tab Ma trận: nạp dữ liệu, nháp, lưu một batch, thanh trên + lưới; rỗng/lỗi/đang tải.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { useMatrixData } from "../../hooks/use-matrix-data";
import { useMatrixDraft } from "../../hooks/use-matrix-draft";
import { useMatrixSave } from "../../hooks/use-matrix-save";
import { GrantMatrix } from "./GrantMatrix";
import { MatrixEmpty } from "./MatrixEmpty";
import { MatrixToolbar } from "./MatrixToolbar";

type Props = { tenantId: string | undefined; tenantKey: string | null };

export function MatrixTab({ tenantId, tenantKey }: Props) {
  const { t } = useTranslation();
  const [showUnopened, setShowUnopened] = useState(false);
  const data = useMatrixData(tenantId, true);
  const d = useMatrixDraft(data.model);
  const save = useMatrixSave({
    tenantId: data.resolvedTenantId ?? tenantId,
    model: data.model,
    refetch: () => void data.query.refetch(),
    onSaved: d.reset,
  });
  const { model } = data;
  if (data.query.isPending) return <LoadingState />;
  if (data.loadError || !model) {
    const { message, code } = data.loadError ?? { message: "", code: "HTTP_ERROR" };
    return <ErrorState message={message} code={code} onRetry={() => void data.query.refetch()} />;
  }
  if (model.groups.length === 0) return <MatrixEmpty tenantKey={tenantKey ?? undefined} />;
  return (
    <>
      <MatrixToolbar
        count={d.count}
        pending={save.pending}
        unopenedCount={model.features.filter((f) => f.state === "none").length}
        showUnopened={showUnopened}
        onShowUnopened={setShowUnopened}
        onSave={() => void save.submit(d.draft)}
        onCancel={d.reset}
      />
      {data.trimmed ? (
        <p role="alert" className="mb-2 text-caption text-muted-foreground">
          {t("access.matrix.groupsTrimmed", { shown: model.groups.length, total: data.total })}
        </p>
      ) : null}
      <GrantMatrix
        model={model}
        draft={d.draft}
        showUnopened={showUnopened}
        onCell={d.cell}
        onRow={d.row}
        onCol={d.col}
      />
      <UnsavedGuard dirty={d.count > 0} />
    </>
  );
}
