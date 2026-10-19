// HD-FR-36 · S05: ghép thẻ duyệt cho trang kiểm/sửa — nút trên tiêu đề + khối dưới tiêu đề (ghi chú / lý do), giữ trang gọn.
// `saveFirst` (trang cấp) lưu ô đã đổi trước khi "Xác nhận" như mgmt-app.
import { type ReactNode, useState } from "react";
import { useApproval } from "../hooks/use-approval";
import { approvalView } from "../lib/approval";
import { ApprovalButtons, ApprovalNote, ReasonForm } from "./ApprovalParts";

export type ApprovalUi = {
  buttons: ReactNode;
  section: ReactNode;
  busy: boolean;
  msg: string | null;
  err: string | null;
};

export function useApprovalUi(o: {
  id: string;
  contractKey: readonly unknown[];
  write: boolean;
  hasSource: boolean;
  saveFirst: () => Promise<void>;
}): ApprovalUi {
  const ap = useApproval(o.id, o.contractKey);
  const [ask, setAsk] = useState<"reject" | "redo" | null>(null);
  const v = approvalView(ap.approval, { write: o.write, hasSource: o.hasSource });
  const buttons = (
    <ApprovalButtons
      v={v}
      busy={ap.busy}
      onConfirm={() =>
        void ap.act({ action: "approve" }, o.saveFirst, "contracts.approval.done.confirm")
      }
      onApprove={() => void ap.act({ action: "approve" })}
      onAsk={setAsk}
    />
  );
  const rejected = ap.approval?.step === "rejected" ? ap.approval.feedback : null;
  const section = (
    <>
      <ApprovalNote note={v.note} rejected={rejected} />
      {ask && (
        <ReasonForm
          kind={ask}
          busy={ap.busy}
          onCancel={() => setAsk(null)}
          onSubmit={async (feedback) => {
            if (await ap.act({ action: ask, feedback })) setAsk(null);
          }}
        />
      )}
    </>
  );
  return { buttons, section, busy: ap.busy !== null, msg: ap.msg, err: ap.err };
}
