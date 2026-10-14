// HUB-FR-128 · P-c1 §1.2 · admin-web trang run: khối "Kết quả tự sửa mã" cho mỗi giai đoạn có `autofix` (neo `autofix-<idx>` cho "Xem diff").
import type { StageView } from "@ai/contracts/chat";
import { useAttachmentLoader } from "../../../hooks/use-attachment-loader";
import { ApplyResult } from "../apply/ApplyResult";
import { AutofixResult } from "./AutofixResult";

export const autofixAnchor = (idx: number): string => `autofix-${idx}`;

export function AutofixBlocks({
  stages,
  tenantId,
}: {
  stages: readonly StageView[];
  tenantId: string | undefined;
}) {
  const load = useAttachmentLoader(tenantId);
  return stages.map((s) => {
    if (s.apply) {
      // FC11 · tự sửa mã đứng liền trước stage Áp (fixture đặt cả hai trên cùng stage ⇒ ưu tiên chính nó).
      const af = s.autofix ?? stages.find((x) => x.idx === s.idx - 1)?.autofix;
      return (
        <div key={s.idx} id={autofixAnchor(s.idx)} className="space-y-2">
          <h2 className="text-body font-semibold">{`${s.idx + 1}. ${s.name}`}</h2>
          <ApplyResult
            view={s.apply}
            base={af?.apply_base ?? null}
            diffFile={af?.diff_file ?? null}
            load={load}
          />
        </div>
      );
    }
    return s.autofix ? (
      <div key={s.idx} id={autofixAnchor(s.idx)} className="space-y-2">
        <h2 className="text-body font-semibold">{`${s.idx + 1}. ${s.name}`}</h2>
        <AutofixResult view={s.autofix} load={load} />
      </div>
    ) : null;
  });
}
