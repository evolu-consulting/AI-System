// CR-181 · s13 · khung «Ký trên tài liệu» trong ô bằng chứng của thẻ duyệt, và thẻ «Ký hợp đồng» cho người có lượt bước Ký.
import type { SignSessionOut } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { myProgress, waitingNames } from "../../lib/contract-view";

/** Liên kết tới màn ký. routeTree.gen.ts (HEAD s12) thiếu `/contracts/sign/$id` trong union `to` ⇒ ép kiểu cho tới khi sinh lại cây route. */
export function OpenSign({
  id,
  label,
  testId = "sign-open",
  variant = "primary",
}: {
  id: string;
  label: string;
  testId?: string;
  variant?: "primary" | "outline";
}) {
  return (
    <Button asChild variant={variant} size="sm">
      <Link to="/contracts/sign/$id" params={{ id }} data-testid={testId}>
        {label}
      </Link>
    </Button>
  );
}

/** Trong thẻ duyệt: số chỗ ký của bạn · đã ký x/y tệp · «Mở và ký». */
export function ApproverSignBox({ id, session }: { id: string; session: SignSessionOut }) {
  const { t } = useTranslation();
  const p = myProgress(session);
  return (
    <div
      data-testid="approver-sign"
      data-ready={p.ready ? "1" : "0"}
      className="rounded-md border border-rule p-3"
    >
      <p className="m-0 text-sm font-medium">{t("contracts.docsignc.boxTitle")}</p>
      <p className="mb-2 mt-1 text-sm text-dim">
        {p.fields > 0
          ? t("contracts.docsignc.boxMine", { fields: p.fields, files: p.files })
          : t("contracts.docsignc.boxFree", { files: p.files })}
        {" · "}
        {t("contracts.docsignc.boxDone", { signed: p.signed, files: p.files })}
      </p>
      <OpenSign id={id} label={t("contracts.docsignc.open")} />
    </div>
  );
}

/** Người có lượt bước Ký (`turn.step = "sign"`): chỉ «Mở và ký». */
export function SignTurnCard({ id, session }: { id: string; session: SignSessionOut }) {
  const { t } = useTranslation();
  const p = myProgress(session);
  return (
    <section data-testid="sign-turn" className="mb-3 rounded-lg border border-rule bg-panel p-4">
      <h3 className="font-semibold">{t("contracts.docsignc.turnTitle")}</h3>
      <p className="mb-2 mt-1 text-sm text-dim">
        {t("contracts.docsignc.boxDone", { signed: p.signed, files: p.files })}
      </p>
      <OpenSign id={id} label={t("contracts.docsignc.open")} />
    </section>
  );
}

/** Người KHÔNG có lượt ở bước Ký: nói đích danh ai ký tiếp («Chờ Nguyễn Văn Hùng ký»). */
export function SignWaitCard({ session }: { session: SignSessionOut }) {
  const { t } = useTranslation();
  return (
    <section data-testid="sign-wait" className="mb-3 rounded-lg border border-rule bg-panel p-4">
      <h3 className="font-semibold">{t("contracts.docsignc.turnTitle")}</h3>
      <p className="mb-0 mt-1 text-sm text-dim">
        {t("contracts.docsignc.waitFor", { name: waitingNames(session) })}
      </p>
    </section>
  );
}
