// price-scout · Cài đặt › "Dò giá thị trường": (a) mặc định cho nhóm Dịch vụ có hạn / Hàng hoá (SP chưa tuỳ chỉnh thì theo), (b) trần lượt dò
// & token mỗi tháng của công ty (+ ô platform chỉ khi `can_override`). Lưu riêng từng khối (không theo nút Lưu cài đặt); chỉ quản lý lưu được
// — người khác bấm Lưu nhận 403 ⇒ báo "không có quyền".
import type { PriceScoutGroup } from "@ai/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { ScoutFields } from "~/features/product-suppliers/components/ScoutFields";
import {
  fromForm,
  type ScoutForm,
  scoutIssue,
  toForm,
} from "~/features/product-suppliers/lib/scout";
import { useSaveScoutDefaults, useScoutDefaults } from "../hooks/use-scout-settings";
import { saveErrorText } from "../lib/scout-ui";
import { Panel } from "./controls";
import { ScoutQuota } from "./ScoutQuota";

function GroupEditor({ group, owner }: { group: PriceScoutGroup; owner: boolean }) {
  const { t } = useTranslation();
  const q = useScoutDefaults();
  const save = useSaveScoutDefaults();
  const cfg = q.data?.groups[group];
  const [form, setForm] = useState<ScoutForm | null>(null);
  useEffect(() => setForm(cfg ? toForm(cfg) : null), [cfg]);
  const issue = form ? scoutIssue(form) : null;
  const L = (k: string) => t(`contracts.scout.${k}`);
  return (
    <Panel title={L(`group.${group}`)} sub={L("groupHint")}>
      <div className="p-5" data-testid={`scout-defaults-${group}`}>
        {form && (
          <ScoutFields
            idp={`scd-${group}`}
            form={form}
            set={setForm}
            disabled={!owner || save.isPending}
          />
        )}
        {issue && (
          <p role="alert" className="mt-2 text-caption text-late">
            {L(`issue.${issue}`)}
          </p>
        )}
        {form && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="btn btn-primary"
              data-testid={`scout-defaults-save-${group}`}
              disabled={!owner || save.isPending || issue !== null}
              onClick={() =>
                save.mutate(
                  { group, config: fromForm(form) },
                  {
                    onSuccess: () => toast(L("saved")),
                    onError: (e) => toast(saveErrorText(e, t), "late"),
                  },
                )
              }
            >
              {L("save")}
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}

export function ScoutPane() {
  const { t } = useTranslation();
  // Quyền sửa do máy chủ quyết (chỉ quản lý); ở đây chỉ chặn người không có quyền ghi gói.
  const owner = useMe().write;
  return (
    <>
      <h2 className="mb-1 text-lg font-semibold">{t("contracts.scout.secTitle")}</h2>
      <p className="mb-3 text-caption text-dim">{t("contracts.scout.secHint")}</p>
      <GroupEditor group="service" owner={owner} />
      <GroupEditor group="goods" owner={owner} />
      <ScoutQuota owner={owner} />
    </>
  );
}
