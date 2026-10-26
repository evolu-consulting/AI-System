// U3 · CR-097a · Cài đặt › "Điểm uy tín" = cách tính điểm của engine HD8 (`/scoring/:role`): hai tab Khách hàng / Nhà cung cấp, mỗi vai lưu riêng
// (version + lịch sử). Thay bản V2-L (5 ô nhóm SP × vai) — V2-E đóng băng. Chỉ chủ sở hữu (contracts-owner) lưu được.
import type { PartnerRole } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Seg } from "./controls";
import { ScoringEditor } from "./ScoringEditor";

export function ScoringPane({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const s = (k: string) => t(`contracts.settings.score.${k}`);
  const [role, setRole] = useState<PartnerRole>("customer");
  return (
    <>
      <h2 className="mb-1 text-lg font-semibold">{s("title")}</h2>
      <p className="mb-3 text-caption text-dim">{s("sub")}</p>
      <div className="mb-4">
        <Seg<PartnerRole>
          value={role}
          label={s("roleAria")}
          options={[
            ["customer", s("role.customer")],
            ["supplier", s("role.supplier")],
          ]}
          onChange={setRole}
        />
      </div>
      <ScoringEditor role={role} owner={owner} />
    </>
  );
}
