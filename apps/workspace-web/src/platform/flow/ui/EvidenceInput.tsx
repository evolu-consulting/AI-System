// CR-127 · U4 · BR-20…26 · MỘT ô «Bằng chứng» dùng mọi nơi người dùng quyết một việc: ý kiến + chữ ký tay + tệp, theo chế độ của bước.
// Tệp/chữ ký tải lên ngay (đường `POST /attachments` sẵn có) và giữ id trong bản nháp; lỗi nói cách khắc phục.
import { EVIDENCE_FILES_MAX, EVIDENCE_NOTE_MAX } from "@ai/contracts/chat";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadAttachment } from "~/components/shared/attachments";
import type { EvidenceDraft, EvidenceIssue, EvidenceRule } from "../lib/evidence";
import { SignaturePad } from "./SignaturePad";

export type EvidenceInputProps = {
  rule: EvidenceRule;
  value: EvidenceDraft;
  onChange: (d: EvidenceDraft) => void;
  /** Lỗi hiện dưới ô (sau khi người dùng bấm gửi mà thiếu). */
  issue?: EvidenceIssue | undefined;
  disabled?: boolean | undefined;
  /** Tests truyền tải-lên giả. */
  upload?: ((f: File) => Promise<{ id: string; filename: string }>) | undefined;
};

export function EvidenceInput({
  rule,
  value,
  onChange,
  issue = null,
  disabled = false,
  upload = uploadAttachment,
}: EvidenceInputProps) {
  const { t } = useTranslation();
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const plus = rule.mode === "opinion_plus";
  const sign = async (f: File | null) => {
    if (!f) return onChange({ ...value, signatureId: null });
    setBusy(true);
    setFailed(false);
    try {
      onChange({ ...value, signatureId: (await upload(f)).id });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setFailed(false);
    try {
      const room = EVIDENCE_FILES_MAX - value.fileIds.length;
      const up = await Promise.all([...list].slice(0, Math.max(room, 0)).map((f) => upload(f)));
      setNames((n) => ({ ...n, ...Object.fromEntries(up.map((a) => [a.id, a.filename])) }));
      onChange({ ...value, fileIds: [...value.fileIds, ...up.map((a) => a.id)] });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const off = disabled || busy;
  return (
    <div data-testid="evidence-input" data-mode={rule.mode} className="flex flex-col gap-3">
      <div>
        <label htmlFor="evidence-note" className="mb-1 block text-sm font-medium">
          {t("contracts.work.u4.evidence.note")}
        </label>
        <textarea
          id="evidence-note"
          rows={3}
          maxLength={EVIDENCE_NOTE_MAX}
          disabled={disabled}
          className="w-full rounded-md border border-rule bg-panel px-3 py-2 text-sm"
          value={value.note}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
        />
      </div>
      {plus && (
        <p className="text-caption text-dim" data-testid="evidence-plus-hint">
          {t("contracts.work.u4.evidence.plusHint")}
        </p>
      )}
      {rule.signature && (
        <div>
          <p className="mb-1 text-sm font-medium">{t("contracts.work.u4.evidence.signature")}</p>
          <SignaturePad disabled={off} onChange={(f) => void sign(f)} />
        </div>
      )}
      {rule.files && (
        <div>
          <label htmlFor="evidence-files" className="mb-1 block text-sm font-medium">
            {t("contracts.work.u4.evidence.files")}
          </label>
          <input
            id="evidence-files"
            type="file"
            multiple
            disabled={off || value.fileIds.length >= EVIDENCE_FILES_MAX}
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {value.fileIds.length > 0 && (
            <ul className="mt-1 text-caption text-dim" data-testid="evidence-file-list">
              {value.fileIds.map((id) => (
                <li key={id} className="flex items-center gap-2">
                  <span>{names[id] ?? id}</span>
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      onChange({ ...value, fileIds: value.fileIds.filter((x) => x !== id) })
                    }
                  >
                    {t("contracts.work.u4.evidence.remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(issue || failed) && (
        <p role="alert" className="text-sm text-late" data-testid="evidence-issue">
          {failed
            ? t("contracts.work.u4.evidence.uploadFail")
            : t(`contracts.work.u4.evidence.issue.${issue}`)}
        </p>
      )}
    </div>
  );
}
