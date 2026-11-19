// CR-191 · BR-191-10 · «Yêu cầu tham gia» nhúng vào Sổ Hợp Tác › Đối tác (nạp lười từ `loadJoinReviewPane` của manifest).
// Dùng đúng danh sách + hộp duyệt của Community (một nguồn, G1) qua ngữ cảnh mỏng `FlowEnv`; quyền xem/duyệt do máy chủ quyết
// (`flows/nav.joinReview`): người không duyệt được ⇒ không vẽ gì.
import { toast } from "@ai/web-kit/ui/toast";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { ready } from "../../application/boot";
import { type FlowEnv, FlowEnvCtx } from "../../application/flow-env";
import { t } from "../../i18n";
import { JoinReview } from "../flows/JoinRequests";
import "../styles/community.css";

const ACCENT = "indigo";

export default function JoinReviewPane() {
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
    <section data-testid="join-requests-panel" className="mb-3">
      <h2 className="px-1 pb-2 text-[13px] font-semibold text-dim">
        {t("community.flows.join.title")}
      </h2>
      <FlowEnvCtx.Provider value={env}>
        <div data-mod="community" data-accent={ACCENT}>
          <JoinReview />
        </div>
      </FlowEnvCtx.Provider>
    </section>
  );
}
