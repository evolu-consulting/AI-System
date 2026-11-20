// CR-191 · cài đặt «Ai được tìm và mời đối tác mới» (chỉ quản trị công ty đổi được; máy chủ cũng trả 403). Nằm trong phần mở của thẻ «Đang kết nối».
import type { ConnectInviteBy } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useTranslation } from "react-i18next";
import { errCodeOf, useConnectSettings, useConnectWrites } from "../hooks/use-connect";
import { connectErrKey } from "../lib/connect";

export function InviteSetting({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  const q = useConnectSettings();
  const { setInviteBy } = useConnectWrites();
  const OPTS: ConnectInviteBy[] = ["admin", "all"];
  // Phản hồi sai dạng (máy chủ giả/lỗi) ⇒ không vẽ cài đặt.
  if (!q.data || !OPTS.includes(q.data.invite_by)) return null;
  return (
    <div
      data-testid="connect-setting"
      className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-rule-soft pt-3"
    >
      <div className="grid gap-1">
        <span className="text-sm font-semibold text-ink">
          {t("contracts.connect.hub.settingTitle")}
        </span>
        {locked && (
          <p data-testid="connect-locked-why" className="text-xs text-dim">
            {t("contracts.connect.hub.lockedWhy")}
          </p>
        )}
      </div>
      <fieldset
        className="m-0 flex gap-1.5 border-0 p-0"
        disabled={locked || setInviteBy.isPending}
      >
        {OPTS.map((o) => (
          <button
            key={o}
            type="button"
            className="chip max-sm:min-h-11"
            data-testid={`connect-setting-${o}`}
            aria-pressed={q.data?.invite_by === o}
            onClick={() =>
              q.data?.invite_by !== o &&
              setInviteBy.mutate(o, {
                onSuccess: () => toast(t("contracts.connect.hub.settingSaved")),
                onError: (e) =>
                  toast(t(`contracts.connect.err.${connectErrKey(errCodeOf(e))}`), "late"),
              })
            }
          >
            {t(
              o === "admin"
                ? "contracts.connect.hub.settingAdmin"
                : "contracts.connect.hub.settingAll",
            )}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
