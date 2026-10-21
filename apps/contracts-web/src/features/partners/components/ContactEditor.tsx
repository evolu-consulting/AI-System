// V2-GAPS · DT-01: sửa điện thoại + người liên hệ ngay ở đầu trang chi tiết đối tác (lưu lên danh bạ; để trống liên hệ ⇒ lấy người đại
// diện bên đối tác ở HĐ mới nhất).
import type { PartnerProfile } from "@ai/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { partnerKeys, saveProfile } from "../api";

export function ContactEditor({
  party,
  profile,
  onClose,
}: {
  party: string;
  profile: PartnerProfile | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.vgaps.contact.${k}`);
  const qc = useQueryClient();
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [contact, setContact] = useState(profile?.contact ?? "");
  const save = useMutation({
    mutationFn: () => saveProfile({ party, phone, contact }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: partnerKeys.profile(party) });
      toast(L("saved"));
      onClose();
    },
  });
  return (
    <form
      aria-label={L("title")}
      className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-rule bg-panel px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label className="flex flex-col gap-1 text-[13px] text-dim">
        {L("phone")}
        <input
          className="field w-52"
          maxLength={30}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-dim">
        {L("person")}
        <input
          className="field w-64"
          maxLength={120}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn-quiet h-9 text-[13px]" disabled={save.isPending}>
        {L("save")}
      </button>
      <button type="button" className="btn btn-outline h-9 text-[13px]" onClick={onClose}>
        {L("cancel")}
      </button>
      {save.isError && (
        <p role="alert" className="w-full text-[13px] text-late">
          {L("error")}
        </p>
      )}
    </form>
  );
}
