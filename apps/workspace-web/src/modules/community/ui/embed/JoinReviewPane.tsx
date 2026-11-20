// CR-193 · «Yêu cầu tham gia» thành các dòng gọn trong thẻ «Yêu cầu chờ duyệt» của Sổ Hợp Tác › Đối tác (nạp lười từ `loadJoinReviewPane`).
// CR-191 · BR-191-10: dùng đúng hộp duyệt của Community (một nguồn, G1) qua ngữ cảnh mỏng `FlowEnv`; quyền xem/duyệt do máy chủ quyết
// (`flows/nav.joinReview`): người không duyệt được ⇒ không vẽ gì.
import { toast } from "@ai/web-kit/ui/toast";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { ready } from "../../application/boot";
import { type FlowEnv, FlowEnvCtx } from "../../application/flow-env";
import { JoinRequestRows } from "../flows/JoinRequestRows";
import "../styles/community.css";

const ACCENT = "indigo";

export default function JoinReviewPane({
  budget,
  onCount,
}: {
  budget: number;
  onCount: (n: number) => void;
}) {
  const [{ api }] = use(ready);
  const [rev, setRev] = useState(0);
  const [allowed, setAllowed] = useState(false);
  const bump = useCallback(() => setRev((n) => n + 1), []);
  useEffect(() => {
    api.flows.nav().then(
      (n) => setAllowed(n.joinReview),
      () => setAllowed(false),
    );
  }, [api]);
  const env = useMemo<FlowEnv>(
    () => ({ flows: api.flows, rev, bump, toast: (m) => toast(m), brandAccent: ACCENT }),
    [api, rev, bump],
  );
  if (!allowed) return null;
  return (
    <FlowEnvCtx.Provider value={env}>
      <div data-testid="join-requests-panel" data-mod="community" data-accent={ACCENT}>
        <JoinRequestRows budget={budget} onCount={onCount} />
      </div>
    </FlowEnvCtx.Provider>
  );
}
