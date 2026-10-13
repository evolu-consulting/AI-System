// HUB-FR-67 · D8 · `button "Xoá profile"` → alertdialog "Xoá {key}?" → DELETE ?version=N. 409 PROFILE_IN_USE → alertdialog
// "Không xoá được {key}" kèm badge `agents[].key`; VERSION_CONFLICT → toast + tải lại danh sách.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "#/components/shared/ConfirmDialog";
import { Button } from "#/components/ui/button";
import { describeApiError } from "#/lib/api-error";
import { useProfileMutations } from "../hooks/use-profile-mutations";
import type { ProfileItem } from "../hooks/use-profiles";
import { type InUse, InUseDialog } from "./InUseDialog";

const codeOf = (e: unknown) => (e as { code?: unknown } | null)?.code;

export function ProfileDelete({
  profile,
  onDeleted,
}: {
  profile: ProfileItem;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const m = useProfileMutations();
  const [asking, setAsking] = useState(false);
  const [inUse, setInUse] = useState<InUse | null>(null);

  const confirm = async () => {
    setAsking(false);
    try {
      await m.remove({ id: profile.id, version: profile.version });
      toast.success(t("models.profile.toast.deleted", { key: profile.key }));
      onDeleted();
    } catch (err) {
      m.reload();
      const refs = (err as { details?: { agents?: InUse["refs"] } }).details?.agents;
      if (codeOf(err) === "PROFILE_IN_USE" && refs) setInUse({ key: profile.key, refs });
      else if (codeOf(err) === "VERSION_CONFLICT")
        toast.error(t("models.errors.conflictDeleteProfile"));
      else {
        const d = describeApiError(err);
        toast.error(t(d.key, d.params));
      }
    }
  };

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setAsking(true)}>
        {t("models.profile.delete.action")}
      </Button>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t("models.profile.delete.title", { key: profile.key })}
        body={t("models.profile.delete.body")}
        confirmLabel={t("models.profile.delete.confirm")}
        destructive
        onConfirm={() => void confirm()}
      />
      <InUseDialog
        value={inUse}
        titleKey="models.profile.inUse.title"
        bodyKey="models.errors.profileInUse"
        onClose={() => setInUse(null)}
      />
    </>
  );
}
