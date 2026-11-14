// CR-157: HĐ nhập tay (dự phòng khi AI đọc lỗi/hết giờ) — nhãn «Nhập tay · cần đối chiếu» / «… đã đối chiếu bởi X» cho mọi người xem (kể
// cả người duyệt); người đang nhập (HĐ còn DRAFT, có quyền ghi) thêm ô tích bắt buộc «Tôi đã đối chiếu với tệp gốc» + nút xem tệp gốc.
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { useReconcile } from "../hooks/use-manage";
import { manualTagKey } from "../lib/manual-entry";
import type { FileRef } from "./ReviewParts";

type View = {
  id: string;
  status: string;
  entry_source?: "manual" | undefined;
  reconciled_by?: string | null | undefined;
  reconciled_at?: string | null | undefined;
};

export function ManualBanner({
  c,
  write,
  file,
  nameOf,
}: {
  c: View;
  write: boolean;
  file: FileRef | null;
  nameOf: (id: string | null) => string | null;
}) {
  const { t } = useTranslation();
  const rec = useReconcile(c.id);
  if (c.entry_source !== "manual") return null;
  const done = !!c.reconciled_at;
  const edit = write && c.status === "draft";
  const tag = manualTagKey(done, nameOf(c.reconciled_by ?? null));
  return (
    <Panel className="mb-4 p-4">
      <div data-testid="manual-banner">
        <p className={`font-medium ${done ? "text-ok" : "text-late"}`} data-testid="manual-tag">
          {t(tag.key, tag.vars)}
        </p>
      </div>
      {edit && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="w-full text-sm text-dim">{t("contracts.review.manualHint")}</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="manual-reconciled"
              checked={done}
              disabled={rec.isPending}
              onChange={(e) => rec.mutate(e.target.checked)}
            />
            {t("contracts.review.manualCheck")}
          </label>
          {file && (
            <button type="button" className="btn btn-outline btn-sm" onClick={file.onOpen}>
              {t("contracts.review.viewFile")}
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}
