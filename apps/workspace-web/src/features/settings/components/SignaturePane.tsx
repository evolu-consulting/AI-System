// CR-181 · s5 · Cài đặt › «Chữ ký» (nhóm Chung, mọi app dùng chung). Mọi thành viên xem; chỉ quản trị sửa (`can_edit`, Q15).
// Tự lưu bằng nút «Lưu định dạng» (không dùng nháp chung của hộp thoại). Bật «Ký trên tài liệu» có hộp xác nhận (Q5).
import {
  SIGNATURE_CAPTIONS,
  SIGNATURE_METHODS,
  type SignatureSettings,
} from "@ai/contracts/signature";
import { Button } from "@ai/web-kit/ui/kit/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai/web-kit/ui/kit/dialog";
import { toast } from "@ai/web-kit/ui/toast";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PaneSkeleton } from "~/components/shared/Refreshing";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "~/shared/ui/settings-layout";
import { useSaveSignatureSettings, useSignatureSettings } from "../hooks/use-signature-settings";
import { putBody, sameSettings, toggleCaption, toggleMethod } from "../lib/signature-form";
import { LoadState } from "./LoadState";
import { ChangeRequests, DigitalCard, SignaturePreview } from "./SignatureAside";
import { Check, Group, Radios } from "./SignatureOptions";

const k = (x: string) => `contracts.settings.signature.${x}`;

export function SignaturePane() {
  const { t } = useTranslation();
  const q = useSignatureSettings();
  const save = useSaveSignatureSettings();
  const [edit, setDraft] = useState<SignatureSettings | null>(null);
  const [confirm, setConfirm] = useState(false);
  const saved = q.data?.settings;
  const draft = edit ?? saved ?? null; // chưa sửa ⇒ hiện bản đã lưu
  useEffect(() => {
    if (saved) setDraft(structuredClone(saved));
  }, [saved]);

  if (q.isLoading || (!q.error && !draft)) return <PaneSkeleton lines={6} />;
  if (q.error || !q.data || !draft)
    return (
      <LoadState
        loading={false}
        error={q.error ?? new Error("signature")}
        retry={() => void q.refetch()}
      />
    );

  const canEdit = q.data.can_edit;
  const dirty = !sameSettings(draft, q.data.settings);
  const set = (p: Partial<SignatureSettings>) => setDraft({ ...draft, ...p });
  const method = (m: (typeof SIGNATURE_METHODS)[number], on: boolean) => {
    const r = toggleMethod(draft, m, on);
    if (r.blocked) toast(t(k("needOneMethod")), "late");
    else setDraft(r.next);
  };
  const onSave = () =>
    save.mutate(putBody(draft), {
      onSuccess: () => toast(t(k("saved"))),
      onError: () => toast(t(k("saveFail")), "late"),
    });
  const lockWhy = canEdit ? undefined : t(k("adminOnly"));

  return (
    <SettingsSection title={t("contracts.settings.sec.signature")} description={t(k("intro"))}>
      {!canEdit && (
        <p className="mb-4 text-label text-dim" data-testid="sig-readonly">
          {t(k("adminOnly"))}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <SettingsGroup title={t(k("onDoc.title"))}>
            <SettingsRow label={t(k("onDoc.label"))} hint={t(k("onDoc.hint"))}>
              <span className={canEdit ? undefined : "pointer-events-none"}>
                <SettingsSwitch
                  label={t(k("onDoc.label"))}
                  checked={draft.on_doc_enabled}
                  onChange={(v) => (v ? setConfirm(true) : set({ on_doc_enabled: false }))}
                />
              </span>
            </SettingsRow>
          </SettingsGroup>
          <SettingsGroup title={t(k("format.title"))}>
            <fieldset
              disabled={!canEdit || save.isPending}
              className="min-w-0 border-0 p-5"
              data-testid="sig-format"
            >
              <Group legend={t(k("format.methods"))}>
                {SIGNATURE_METHODS.map((m) => (
                  <Check
                    key={m}
                    id={`sig-m-${m}`}
                    label={t(k(`method.${m}`))}
                    checked={draft.methods.includes(m)}
                    onChange={(v) => method(m, v)}
                  />
                ))}
              </Group>
              <Group legend={t(k("format.required"))}>
                <Radios
                  id="req"
                  label={t(k("format.required"))}
                  value={draft.required ? "1" : "0"}
                  options={[
                    ["1", t(k("required.yes"))],
                    ["0", t(k("required.later"))],
                  ]}
                  onChange={(v) => set({ required: v === "1" })}
                />
              </Group>
              <Group legend={t(k("format.caption"))}>
                {SIGNATURE_CAPTIONS.map((c) => (
                  <Check
                    key={c}
                    id={`sig-c-${c}`}
                    label={t(k(`caption.${c}`))}
                    checked={draft.caption.includes(c)}
                    onChange={(v) => setDraft(toggleCaption(draft, c, v))}
                  />
                ))}
              </Group>
              <Group legend={t(k("format.ink"))}>
                <Radios
                  id="ink"
                  label={t(k("format.ink"))}
                  value={draft.ink}
                  options={[
                    ["blue", t(k("ink.blue"))],
                    ["black", t(k("ink.black"))],
                  ]}
                  onChange={(ink) => set({ ink })}
                />
              </Group>
              <Group legend={t(k("format.initials"))}>
                <Radios
                  id="ini"
                  label={t(k("format.initials"))}
                  value={draft.initials}
                  options={[
                    ["shrink", t(k("initials.shrink"))],
                    ["own", t(k("initials.own"))],
                  ]}
                  onChange={(initials) => set({ initials })}
                />
              </Group>
              <Group legend={t(k("format.change"))}>
                <Radios
                  id="chg"
                  label={t(k("format.change"))}
                  value={draft.change_policy}
                  options={[
                    ["self", t(k("change.self"))],
                    ["admin", t(k("change.admin"))],
                  ]}
                  onChange={(change_policy) => set({ change_policy })}
                />
              </Group>
            </fieldset>
            <div className="flex flex-wrap items-center gap-3 border-t border-rule-soft px-5 py-3">
              <Button
                busy={save.isPending}
                disabled={!dirty}
                disabledReason={lockWhy}
                onClick={onSave}
              >
                {t(k("save"))}
              </Button>
              <span className="text-caption text-dim">{t(k("appliesLater"))}</span>
            </div>
          </SettingsGroup>
        </div>
        <div className="min-w-0">
          <SignaturePreview s={draft} />
          <DigitalCard />
          {canEdit && <ChangeRequests />}
        </div>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(k("onDoc.confirmTitle"))}</DialogTitle>
            <DialogDescription>{t(k("onDoc.confirmBody"))}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="quiet" onClick={() => setConfirm(false)}>
              {t(k("onDoc.cancel"))}
            </Button>
            <Button
              onClick={() => {
                set({ on_doc_enabled: true });
                setConfirm(false);
              }}
            >
              {t(k("onDoc.confirm"))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
