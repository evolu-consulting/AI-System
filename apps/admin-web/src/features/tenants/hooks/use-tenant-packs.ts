// PK-FR-05 · D-05 · UAT CR-095 B3: tab "Gói" của chi tiết tenant (chỉ platform_admin) — bật (PUT, không hỏi) / tắt (hỏi xác
// nhận, DELETE). Công tắc không optimistic: chờ server rồi làm mới; lỗi ⇒ toast, công tắc về cũ.
import type { PackState } from "@ai/contracts";
import { useState } from "react";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useSetTenantPack, useTenantPacks } from "../api";

const KNOWN = new Set(["contracts", "knowledge"]);

/** Tên hiển thị gói: khoá đã biết ⇒ nhãn i18n; khoá lạ ⇒ chính khoá. */
export function packLabel(t: (k: string) => string, key: string): string {
  return KNOWN.has(key) ? t(`tenants.packs.name.${key}`) : key;
}

export function useTenantPackList(tenant: { id: string; name: string }) {
  const t = useTr();
  const list = useTenantPacks(tenant.id, true);
  const set = useSetTenantPack(tenant.id);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [off, setOff] = useState<PackState | null>(null);

  const run = async (row: PackState, on: boolean) => {
    setPendingKey(row.key);
    try {
      await set.mutateAsync({ key: row.key, on });
      const key = on ? "tenants.packs.toast.on" : "tenants.packs.toast.off";
      notifySuccess(t(key, { name: packLabel(t, row.key), tenant: tenant.name }));
    } catch (err) {
      const spec = describeError(err);
      notifyError(t(spec.key, spec.params));
    } finally {
      setPendingKey(null);
    }
  };
  const e = list.error;
  const apiErr = e instanceof ApiError ? e : null;
  return {
    list,
    forbidden: apiErr?.status === 403,
    loadError: e
      ? { message: e.message, code: apiErr ? String(apiErr.code) : "NETWORK_ERROR" }
      : null,
    pendingKey,
    off,
    /** Bật ⇒ làm ngay; tắt ⇒ mở hộp xác nhận. */
    toggle: (row: PackState, want: boolean) => (want ? void run(row, true) : setOff(row)),
    cancelOff: () => setOff(null),
    confirmOff: async () => {
      const row = off;
      setOff(null);
      if (row) await run(row, false);
    },
  };
}
