// HUB-FR-128 · P-c1 §1.2 · admin-web trang run: khối "Kết quả tự sửa mã" cho mỗi giai đoạn có `autofix` (neo `autofix-<idx>` cho "Xem diff").
import type { StageView } from "@ai/contracts/chat";
import { useAttachmentLoader } from "../../../hooks/use-attachment-loader";
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
  return stages.map((s) =>
    s.autofix ? (
      <div key={s.idx} id={autofixAnchor(s.idx)} className="space-y-2">
        <h2 className="text-body font-semibold">{`${s.idx + 1}. ${s.name}`}</h2>
        <AutofixResult view={s.autofix} load={load} />
      </div>
    ) : null,
  );
}
