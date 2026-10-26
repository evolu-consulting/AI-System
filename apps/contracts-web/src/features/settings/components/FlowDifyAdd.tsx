// cf-dify · "Thêm bước Dify": chọn một quy trình Dify trong danh mục công ty (`GET /pack/contracts/dify-workflows`), thêm vào cuối luồng.
// Danh mục rỗng ⇒ ghi chú thay vì nút; tải lỗi ⇒ ghi chú (luồng vẫn sửa được bước duyệt).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DifyWorkflowItem } from "../api-flow";
import { FIELD } from "./controls";

const BTN = "h-9 rounded-lg border border-rule px-3 text-label hover:bg-sunk disabled:opacity-50";

type Props = {
  items: DifyWorkflowItem[] | undefined;
  failed: boolean;
  full: boolean;
  onAdd: (w: DifyWorkflowItem) => void;
};

export function FlowDifyAdd({ items, failed, full, onAdd }: Props) {
  const { t } = useTranslation();
  const f = (k: string) => t(`contracts.flow.${k}`);
  const [key, setKey] = useState("");
  if (failed) return <p className="mt-2 text-caption text-dim">{f("difyListFail")}</p>;
  if (!items) return null;
  if (items.length === 0) return <p className="mt-2 text-caption text-dim">{f("difyNone")}</p>;
  const chosen = items.find((w) => w.key === key);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="flow-dify-add">
      <select
        className={`${FIELD} max-w-72`}
        aria-label={f("addDify")}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      >
        <option value="">{f("difyPick")}</option>
        {items.map((w) => (
          <option key={w.key} value={w.key}>
            {w.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={BTN}
        disabled={!chosen || full}
        onClick={() => {
          if (!chosen) return;
          onAdd(chosen);
          setKey("");
        }}
      >
        {f("addDify")}
      </button>
    </div>
  );
}
