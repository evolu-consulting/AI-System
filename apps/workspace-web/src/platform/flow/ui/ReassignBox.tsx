// CR-127 · U4b-1 · E2/E3b · «Chuyển cho…»: chọn người + lý do (bắt buộc) ⇒ `POST /review-tasks/:id/reassign`.
// Chỉ trưởng phòng / quản trị công ty giao lại được — máy chủ quyết (`NOT_GROUP_HEAD`), lỗi hiện kèm cách khắc phục.
import { useState } from "react";
import { useTranslation } from "react-i18next";

export type Person = { id: string; name: string };
const NOTE_MAX = 500;

export function ReassignBox({
  people,
  busy,
  onSend,
  onCancel,
}: {
  people: readonly Person[];
  busy: boolean;
  onSend: (toUserId: string, note: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const ready = to !== "" && note.trim() !== "";
  return (
    <div
      data-testid="reassign-box"
      className="flex w-full flex-col gap-2 rounded-lg border border-line p-3"
    >
      <label className="flex flex-col gap-1 text-sm">
        {t("contracts.work.u4.reassign.who")}
        <select
          data-testid="reassign-who"
          className="rounded-md border border-rule bg-panel px-2 py-1.5 text-sm"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        >
          <option value="">{t("contracts.work.u4.reassign.pick")}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("contracts.work.u4.reassign.reason")}
        <textarea
          data-testid="reassign-note"
          rows={2}
          maxLength={NOTE_MAX}
          className="w-full rounded-md border border-rule bg-panel px-3 py-2 text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {!ready && (
        <p className="m-0 text-caption text-dim">{t("contracts.work.u4.reassign.need")}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          data-testid="reassign-confirm"
          disabled={busy || !ready}
          onClick={() => onSend(to, note.trim())}
        >
          {t("contracts.work.u4.reassign.confirm")}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>
          {t("contracts.requests.cancel")}
        </button>
      </div>
    </div>
  );
}
