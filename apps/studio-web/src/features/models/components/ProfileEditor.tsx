// HUB-FR-67 · AC-H4b2-03 · editor profile (cột phải): Tên (chỉ đọc khi sửa) + StepsEditor + [Lưu profile] (bật khi có thay đổi)
// + [Xoá profile] (chỉ profile đã lưu). Lưu: POST {key, steps} / PUT {version, steps}; 409 phiên bản → ConflictDialog (D10).
import type { ModelProfile } from "@ai/contracts/studio";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConflictDialog } from "#/components/shared/conflict/ConflictDialog";
import { useConflict } from "#/components/shared/conflict/use-conflict";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { describeApiError } from "#/lib/api-error";
import { useProfileMutations } from "../hooks/use-profile-mutations";
import type { ProfileItem } from "../hooks/use-profiles";
import type { ProviderItem } from "../hooks/use-providers";
import {
  type Draft,
  type DraftErrors,
  draftOf,
  fieldError,
  hasErrors,
  isDirty,
  stepsBody,
  validate,
} from "../lib/profile-draft";
import { LiveSummary } from "./LiveSummary";
import { ProfileDelete } from "./ProfileDelete";
import { StepsEditor } from "./StepsEditor";

type Props = {
  profile: ProfileItem | null;
  providers: readonly ProviderItem[];
  onSaved: (id: string) => void;
  onDeleted: () => void;
};
const NO_ERRORS: DraftErrors = { step: {} };

export function ProfileEditor({ profile, providers, onSaved, onDeleted }: Props) {
  const { t } = useTranslation();
  const m = useProfileMutations();
  const [draft, setDraft] = useState<Draft>(() => draftOf(profile));
  const [errors, setErrors] = useState<DraftErrors>(NO_ERRORS);
  const [saving, setSaving] = useState(false);
  const dirty = isDirty(draft, profile);
  const keys = useMemo(() => providers.map((p) => p.key), [providers]);
  const allSub = useMemo(() => {
    if (profile && !dirty) return profile.all_subscription;
    const kind = new Map(providers.map((p) => [p.key, p.kind]));
    return (
      draft.steps.length > 0 &&
      draft.steps.every((s) => s.provider_key !== "" && kind.get(s.provider_key) === "subscription")
    );
  }, [profile, dirty, draft.steps, providers]);

  const send = async (version: number) => {
    const steps = stepsBody(draft);
    const saved = profile
      ? await m.update({ id: profile.id, body: { version, steps } })
      : await m.create({ key: draft.key.trim(), steps });
    toast.success(t("models.profile.saved", { key: saved.key }));
    onSaved(saved.id);
  };
  const fail = (err: unknown) => {
    const f = fieldError(err);
    if (f) return setErrors(f);
    const d = describeApiError(err);
    toast.error(t(d.key, d.params));
  };
  const conflict = useConflict<ModelProfile>({
    buildRows: () => ({ rows: [], more: 0 }),
    submit: (version) => send(version),
    onReload: () => m.reload(),
    onError: fail,
  });
  const submit = async () => {
    const e = validate(draft, !profile);
    setErrors(e);
    if (hasErrors(e)) return;
    const version = profile?.version ?? 1;
    setSaving(true);
    try {
      await send(version);
    } catch (err) {
      if (!conflict.capture(err, version)) fail(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-56 space-y-1">
          <Label htmlFor="profile-key">{t("models.profile.field.name")}</Label>
          <Input
            id="profile-key"
            value={draft.key}
            readOnly={!!profile}
            autoComplete="off"
            className="font-mono"
            aria-invalid={!!errors.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value })}
          />
          {profile ? (
            <p className="text-label text-muted-foreground">
              {t("models.provider.field.kindLocked")}
            </p>
          ) : null}
          {errors.key ? <p className="text-label text-destructive">{t(errors.key)}</p> : null}
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={!dirty || saving}>
            {t("models.profile.save")}
          </Button>
          {profile ? <ProfileDelete profile={profile} onDeleted={onDeleted} /> : null}
        </div>
      </div>
      <LiveSummary profile={profile} allSubscription={allSub} />
      <StepsEditor
        steps={draft.steps}
        providers={keys}
        errors={errors}
        onChange={(steps) => setDraft({ ...draft, steps })}
      />
      {conflict.props ? <ConflictDialog {...conflict.props} /> : null}
    </form>
  );
}
