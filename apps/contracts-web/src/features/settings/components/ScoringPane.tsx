// U3 · REP-v3-ui · Cài đặt › "Điểm uy tín" theo `engine` (`GET /reputation/config`):
//  - `hd8`: cách tính của engine HD8 (`/scoring/:role`), hai tab Khách hàng / Nhà cung cấp, mỗi vai lưu riêng (version + lịch sử);
//  - `v2e`: 5 ô nhóm SP × vai + Mức & đánh giá (`ScoringV2EPane`); ẩn cấu hình điểm HD8 và chỉnh tay ±10 (máy chủ trả 410).
// Quản lý (`owner`) thấy thêm màn xem trước "N đối tác đổi mức" (chỉ đọc). Chỉ chủ sở hữu (contracts-owner) lưu được.
import type { PartnerRole } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useEngine } from "~/features/partners/hooks/use-rep-v2e";
import { Seg } from "./controls";
import { ScoringEditor } from "./ScoringEditor";
import { ScoringV2EPane } from "./ScoringV2EPane";
import { SwitchPreview } from "./SwitchPreview";

function Hd8Pane({ owner }: { owner: boolean }) {
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

export function ScoringPane({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const { engine, loading } = useEngine();
  if (loading || !engine) return <p className="text-dim">{t("contracts.common.loading")}</p>;
  return (
    <>
      {owner && (
        <div className="mb-4">
          <SwitchPreview engine={engine} />
        </div>
      )}
      {engine === "v2e" ? <ScoringV2EPane owner={owner} /> : <Hd8Pane owner={owner} />}
    </>
  );
}
