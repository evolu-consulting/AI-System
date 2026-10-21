// V2-GAPS · DT-01 → GAP-D2 · #24: sửa NHIỀU người liên hệ của đối tác ngay ở đầu trang chi tiết (tên, chức vụ, điện thoại, email,
// người phụ trách bên mình). Lưu = thay cả danh sách; người đầu tiên hiện ở đầu trang. Dòng trống bị bỏ.
import type { PartnerContactPerson } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { useSaveContacts } from "../hooks/use-partner-rep";
import { blankRow, CONTACTS_MAX, type ContactRow, draftsOf, rowsOf } from "../lib/contacts";

const FIELDS = [
  ["name", "w-44", 120],
  ["role", "w-36", 120],
  ["phone", "w-36", 30],
  ["email", "w-48", 200],
  ["our_owner", "w-40", 120],
] as const;

export function ContactEditor({
  party,
  contacts,
  onClose,
}: {
  party: string;
  contacts: readonly PartnerContactPerson[] | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.vgaps.contact.${k}`, o);
  const [rows, setRows] = useState<ContactRow[]>(() => {
    const r = rowsOf(contacts);
    return r.length ? r : [blankRow()];
  });
  const [bad, setBad] = useState<string | null>(null);
  const save = useSaveContacts(party, () => {
    toast(L("saved"));
    onClose();
  });
  const set = (key: string, p: Partial<ContactRow>) =>
    setRows((s) => s.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const submit = () => {
    const d = draftsOf(rows);
    if ("err" in d) return setBad(L(d.err === "missing_name" ? "needName" : "tooMany"));
    setBad(null);
    save.mutate(d.ok);
  };
  return (
    <form
      aria-label={L("title")}
      className="mb-4 space-y-3 rounded-xl border border-rule bg-panel px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h3 className="text-[14px] font-semibold">{L("title")}</h3>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.key} className="flex flex-wrap items-end gap-2" data-contact-row>
            {FIELDS.map(([f, w, max]) => (
              <label key={f} className="flex flex-col gap-1 text-[12.5px] text-dim">
                {L(f)}
                <input
                  className={`field ${w}`}
                  maxLength={max}
                  value={r[f]}
                  aria-label={`${L(f)} ${i + 1}`}
                  onChange={(e) => set(r.key, { [f]: e.target.value })}
                />
              </label>
            ))}
            <button
              type="button"
              className="btn btn-quiet h-9 text-[13px] text-late"
              aria-label={`${L("remove")} ${i + 1}`}
              onClick={() => setRows((s) => s.filter((x) => x.key !== r.key))}
            >
              {L("remove")}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-outline h-9 text-[13px]"
          disabled={rows.length >= CONTACTS_MAX}
          onClick={() => setRows((s) => [...s, blankRow()])}
        >
          {L("add")}
        </button>
        <button type="submit" className="btn btn-quiet h-9 text-[13px]" disabled={save.isPending}>
          {L("save")}
        </button>
        <button type="button" className="btn btn-outline h-9 text-[13px]" onClick={onClose}>
          {L("cancel")}
        </button>
      </div>
      {(bad || save.isError) && (
        <p role="alert" className="text-[13px] text-late">
          {bad ?? L("error")}
        </p>
      )}
    </form>
  );
}
