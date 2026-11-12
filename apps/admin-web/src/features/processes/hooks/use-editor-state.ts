// CR-127 · hook nạp def + trigger + áp dụng của trình sửa quy trình (tách từ ProcessEditorPage).
import type { FlowTrigger } from "@ai/contracts/hub-admin";
import { useEffect, useRef, useState } from "react";
import { useProcessDef } from "../api";
import { copyTenantId, isCompanyOwned, scopedTenantId } from "../lib/company-copy";
import { toDraft } from "../lib/def-form";
import { hasTrigger, healFlowInputs } from "../lib/flow-def";
import type { LibraryDef } from "../library-api";
import { useApplyFlow } from "./use-apply-flow";
import type { useDraft } from "./use-draft";
import { useProcessTenant } from "./use-process-tenant";

export function useLoadedDef(
  processId: string | undefined,
  d: ReturnType<typeof useDraft>,
  company: string | undefined,
) {
  const picked = useProcessTenant();
  // platform_admin mở từ Công ty › Quy trình: công ty theo `?company=` (Hub cần tenant_id để đọc/lưu def của công ty).
  const tenantId = scopedTenantId(picked.isPlatform, picked.tenantId, company);
  const tenant = tenantId === picked.tenantId ? picked : { ...picked, tenantId, ready: true };
  const q = useProcessDef(processId, tenant.tenantId);
  const [version, setVersion] = useState(1);
  const loaded = useRef<string | null>(null);
  // CR-105: quy trình thư viện (có khe) nạp lại bản nháp mỗi khi `version` đổi (Form/Hub biên dịch lại `stages`); loại khác nạp một lần.
  const data: LibraryDef | undefined = q.data;
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp một lần cho mỗi quy trình; làm tươi nền không đè bản đang sửa
  useEffect(() => {
    // thư viện + bản riêng sao từ thư viện (c17b: Form lưu slot_body ⇒ nạp lại theo version)
    const key = data?.slot || data?.source_template_id ? `${data.id}:${data.version}` : data?.id;
    if (data && loaded.current !== key) {
      loaded.current = key ?? null;
      // CR-122 p17 · flow theo sự kiện: input def luôn có khoá bản ghi của sự kiện (contract_id) để bộ chọn nguồn + kiểm đọc được.
      d.load(
        toDraft(hasTrigger(data) ? { ...data, inputs: healFlowInputs(data.inputs, data) } : data),
      );
      setVersion(data.version);
    }
  }, [data]);
  return { tenant, q, version, setVersion };
}

/** CR-122 · U1: flow có trigger = FlowDef mới; trigger sửa ở state riêng, gửi kèm khi Lưu. */
export function useFlowTrigger(data: unknown, draftDirty: boolean) {
  const src = hasTrigger(data) ? data : null;
  const [edit, setEdit] = useState<FlowTrigger | null>(null);
  const trig = src ? (edit ?? src.trigger) : null;
  const dirty = draftDirty || (!!src && JSON.stringify(trig) !== JSON.stringify(src.trigger));
  const extra = src && trig ? { trigger: trig, app: src.app } : {};
  return { src, trig, setEdit, dirty, extra };
}

/** CR-123 FR-10: bản của công ty ⇒ lưu xong tự áp dụng (MỘT nút "Lưu và áp dụng"); loại khác không làm gì. */
export function useApplyForDef(
  def: LibraryDef | undefined,
  lib: LibraryDef | null,
  id: string | undefined,
) {
  const ap = useApplyFlow(isCompanyOwned(def, lib) ? copyTenantId(def) : null, id);
  return { ...ap, afterSave: ap.active ? ap.apply : undefined };
}
