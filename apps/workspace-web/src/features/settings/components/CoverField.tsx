// CR-138 Q9 · «Ảnh bìa công ty» ở Cài đặt › Công ty cạnh logo (cùng khuôn với logo): PNG/JPG/WebP ≤ 3 MB, gợi ý tỉ lệ 4:1, chỉ chủ sở hữu.
// Lưu cùng nút Lưu chung (thân PUT `/company`: vắng = giữ, ảnh = thay, null = xoá). Chưa có ảnh ⇒ ô mẫu nền màu chủ đạo (như hồ sơ Bảng tin).
import { COMPANY_COVER_MAX_BYTES } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Btn } from "~/components/ui/Btn";
import { useCompanyCover } from "../hooks/use-settings";
import { accentSwatch } from "../lib/brand";
import { coverShown } from "../lib/data";
import type { CompanyDraft } from "../lib/types";

const TYPES = ["image/png", "image/jpeg", "image/webp"];

export function CoverField({
  value: c,
  set,
}: {
  value: CompanyDraft;
  set: (c: CompanyDraft) => void;
}) {
  const { t } = useTranslation();
  const s = (k: string) => t(`contracts.settings.co.${k}`);
  const file = useRef<HTMLInputElement>(null);
  const saved = useCompanyCover(c.has_cover && c.cover === undefined);
  const shown = coverShown(c, saved.data?.cover);
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!TYPES.includes(f.type)) return toast(s("coverType"), "late");
    if (f.size > COMPANY_COVER_MAX_BYTES) return toast(s("coverBig"), "late");
    const r = new FileReader();
    r.onload = () => set({ ...c, cover: String(r.result) });
    r.readAsDataURL(f);
  };
  return (
    <div className="flex flex-col gap-2">
      <div
        data-testid="cover-preview"
        className="h-20 w-full max-w-xl overflow-hidden rounded-lg border border-rule"
        style={shown ? undefined : { background: accentSwatch(c.accent) }}
      >
        {shown && <img src={shown} alt={s("coverAlt")} className="h-full w-full object-cover" />}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={file}
          type="file"
          hidden
          accept={TYPES.join(",")}
          data-testid="cover-file"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Btn variant="outline" size="sm" onClick={() => file.current?.click()}>
          {shown ? s("coverChange") : s("coverUpload")}
        </Btn>
        {shown && (
          <Btn size="sm" variant="quiet" onClick={() => set({ ...c, cover: null })}>
            {s("coverRemove")}
          </Btn>
        )}
        <p className="basis-full text-caption text-dim">{s("coverHint")}</p>
      </div>
    </div>
  );
}
