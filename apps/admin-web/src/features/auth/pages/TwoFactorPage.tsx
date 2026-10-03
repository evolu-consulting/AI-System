// ADM-FR-08 · M4-R16 · M4-AC11 · /account/2fa (ms §10.1, canvas `Enable2FA`): card 560px, các bước trong cùng card.
// Member bị guard chuyển về /member. Rời trang ở bước Lưu mã → UnsavedGuard.
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Card, CardContent } from "@/components/ui/card";
import { useSession } from "@/lib/auth/use-session";
import { BackupCodesStep } from "../components/totp/BackupCodesStep";
import { ReauthStep } from "../components/totp/ReauthStep";
import { ScanStep } from "../components/totp/ScanStep";
import { TotpConfirmDialog } from "../components/totp/TotpConfirmDialog";
import { TotpStatus } from "../components/totp/TotpStatus";
import { VerifyStep } from "../components/totp/VerifyStep";
import { useTotpManage } from "../hooks/use-totp-manage";
import { useTotpSetup } from "../hooks/use-totp-setup";
import { isUnsaved, stepNumber } from "../lib/totp-steps";

export function TwoFactorPage() {
  const { t } = useTranslation();
  const me = useSession((s) => s.me);
  const setup = useTotpSetup();
  const manage = useTotpManage(setup.showCodes);
  const { state } = setup;
  const tenant = me?.tenant.key ?? "";
  const username = me?.username ?? "";
  const n = stepNumber(state);

  return (
    <div className="max-w-[560px]">
      <PageHeader title={t("twofa.title")} />
      <UnsavedGuard dirty={isUnsaved(state)} />
      <Card>
        <CardContent className="space-y-4">
          {n ? (
            <p className="text-caption text-muted-foreground">{t("twofa.step", { n })}</p>
          ) : null}
          {state.step === "idle" ? (
            <TotpStatus
              enabled={me?.totp_enabled ?? false}
              enabledAt={me?.totp_enabled_at ?? null}
              codesLeft={me?.backup_codes_left ?? 0}
              onEnable={() => setup.go("start")}
              onRegenerate={() => manage.open("regen")}
              onDisable={() => manage.open("disable")}
            />
          ) : null}
          {state.step === "reauth" ? (
            <ReauthStep
              busy={setup.busy}
              error={setup.error}
              onSubmit={setup.submitPassword}
              onCancel={() => setup.go("reset")}
            />
          ) : null}
          {state.step === "scan" ? (
            <ScanStep
              setup={state.setup}
              tenant={tenant}
              username={username}
              onNext={() => setup.go("next")}
              onCancel={() => setup.go("reset")}
            />
          ) : null}
          {state.step === "verify" ? (
            <VerifyStep
              busy={setup.busy}
              error={setup.error}
              onSubmit={setup.submitCode}
              onBack={() => setup.go("back")}
            />
          ) : null}
          {state.step === "backup" ? (
            <BackupCodesStep
              codes={state.codes}
              tenant={tenant}
              username={username}
              onDone={setup.finish}
            />
          ) : null}
        </CardContent>
      </Card>
      <TotpConfirmDialog
        open={manage.dialog === "disable"}
        onOpenChange={(o) => !o && manage.open(null)}
        title={t("twofa.disable.title")}
        description={t("twofa.disable.body")}
        confirmLabel={t("twofa.disable.action")}
        destructive
        needPassword
        busy={manage.busy}
        error={manage.error}
        onConfirm={manage.disable}
      />
      <TotpConfirmDialog
        open={manage.dialog === "regen"}
        onOpenChange={(o) => !o && manage.open(null)}
        title={t("twofa.regen.title")}
        description={t("twofa.regen.body")}
        confirmLabel={t("twofa.regen.submit")}
        needPassword={false}
        busy={manage.busy}
        error={manage.error}
        onConfirm={manage.regenerate}
      />
    </div>
  );
}
