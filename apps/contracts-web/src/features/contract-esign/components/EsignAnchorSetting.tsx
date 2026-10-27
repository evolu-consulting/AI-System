// esign-anchor · Cài đặt › Ký số: danh sách cụm tìm khối chữ ký trong văn bản HĐ cho Bên A (công ty) / Bên B (đối tác), mỗi dòng một
// cụm theo thứ tự ưu tiên. Owner sửa (PUT /esign/anchors); người khác chỉ xem.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { useEsignAnchors } from "../anchor-api";

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x !== "");

export function EsignAnchorSetting({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const { q, m } = useEsignAnchors(() => toast(t("contracts.esignAnchor.saveErr"), "late"));
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  useEffect(() => {
    if (q.data) {
      setA(q.data.a.join("\n"));
      setB(q.data.b.join("\n"));
    }
  }, [q.data]);
  if (!q.data) return null;
  const ok = lines(a).length > 0 && lines(b).length > 0;
  const field = (id: "a" | "b", v: string, set: (s: string) => void) => (
    <label className="flex flex-1 flex-col gap-1">
      <span className="font-semibold">{t(`contracts.esignAnchor.${id}`)}</span>
      <textarea
        className="field min-h-20"
        data-testid={`esign-anchor-${id}`}
        value={v}
        rows={3}
        disabled={!owner || m.isPending}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
  return (
    <div className="mt-4 flex flex-col gap-2 text-[13px]" data-testid="esign-anchor-setting">
      <span className="font-semibold">{t("contracts.esignAnchor.title")}</span>
      <p className="text-caption text-dim">{t("contracts.esignAnchor.hint")}</p>
      <div className="flex gap-3 max-sm:flex-col">
        {field("a", a, setA)}
        {field("b", b, setB)}
      </div>
      {owner && (
        <button
          type="button"
          className="btn btn-quiet self-start"
          data-testid="esign-anchor-save"
          disabled={!ok || m.isPending}
          onClick={() => m.mutate({ a: lines(a), b: lines(b) })}
        >
          {t("contracts.esignAnchor.save")}
        </button>
      )}
    </div>
  );
}
