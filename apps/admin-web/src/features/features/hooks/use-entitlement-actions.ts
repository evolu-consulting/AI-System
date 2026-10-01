// ADM-FR-31 · cấp (PUT) và thu hồi (DELETE) entitlement; thu hồi có Hoàn tác 5 s = cấp lại (cùng hàng, M2-AC05).
import type { Entitlement, FeatureDetail } from "@ai/contracts";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { useGrantEntitlement, useRevokeEntitlement } from "../api";
import type { RevokeTarget } from "../components/RevokeDialog";

const UNDO_MS = 5000;

/** Toast lỗi bền (bỏ qua 401: modal phiên hết hạn xử lý). */
function useFail() {
  const tr = useTr();
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err);
      notifyError(tr(spec.key, spec.params));
    },
    [tr],
  );
}

export function useEntitlementActions(feature: FeatureDetail) {
  const { t, i18n } = useTranslation();
  const fail = useFail();
  const grantMut = useGrantEntitlement(feature.id);
  const revokeMut = useRevokeEntitlement(feature.id);
  const [target, setTarget] = useState<RevokeTarget | null>(null);
  const name = pickLocalized(feature.name, i18n.language);

  const grant = async (tenant: { id: string; key: string }) => {
    try {
      await grantMut.mutateAsync(tenant.id);
      notifySuccess(t("features.toast.granted", { feature: name, tenant: tenant.key }));
    } catch (err) {
      fail(err);
    }
  };
  const askRevoke = (e: Entitlement) =>
    setTarget({
      tenantId: e.tenant_id,
      tenantKey: e.tenant_key,
      feature: name,
      users: e.active_user_count,
      commands: feature.command_count,
    });
  const revoke = async (x: RevokeTarget) => {
    await revokeMut.mutateAsync(x.tenantId).catch((err) => {
      fail(err);
      throw err; // giữ hộp thoại mở
    });
    const undo = {
      label: t("common.undo"),
      onClick: () => void grantMut.mutateAsync(x.tenantId).catch(fail),
    };
    const msg = t("features.toast.revoked", { feature: x.feature, tenant: x.tenantKey });
    notifySuccess(msg, undo, UNDO_MS);
  };

  return { target, grant, askRevoke, revoke, closeRevoke: () => setTarget(null) };
}
