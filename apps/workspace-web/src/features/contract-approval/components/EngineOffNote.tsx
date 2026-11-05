// engine-off-note · HĐ duyệt theo cách cũ (không phải engine) trong khi công ty đã được gán quy trình riêng nhưng chưa bật "Duyệt theo quy trình"
// (feature `contracts-approval-engine`) ⇒ nói rõ vì sao quy trình đã gán không chạy (Luật GỐC #3: màn hình nêu trạng thái + lý do).
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchFlow } from "~/features/settings/api-flow";
import { featureFlag } from "~/platform/features/gate";

export const ENGINE_FEATURE = "contracts-approval-engine";

export function EngineOffNote({
  step,
  mode,
}: {
  step: string | null | undefined;
  mode: string | null | undefined;
}) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["approval", "engine-off-note"],
    enabled: !!step && mode !== "engine",
    staleTime: 60_000,
    queryFn: async (): Promise<boolean> => {
      if (await featureFlag(ENGINE_FEATURE)) return false;
      return !(await fetchFlow()).isDefault;
    },
  });
  if (!step || mode === "engine" || !q.data) return null;
  return (
    <p data-approval="engine-off" role="status" className="mb-3 text-sm text-late">
      {t("contracts.approval.engineOff")}
    </p>
  );
}
