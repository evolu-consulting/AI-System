// PK-FR-10 · HD-FR-26 · S04: /contracts/new — HĐ phải tải lên (CR-097 K3a). DOC-ui-list: `?type=deal` ⇒ form Giao dịch (nhập tay, file không
// bắt buộc); `?frame=<id>` (menu "Thêm HĐ/Giao dịch" của HĐ nguyên tắc) ⇒ Giao dịch gắn sẵn HĐ nguyên tắc đó.
import { createFileRoute } from "@tanstack/react-router";
import { DealNewPage } from "~/features/contract-new/pages/DealNewPage";
import { NewContractPage } from "~/features/contract-new/pages/NewContractPage";

type NewSearch = { type?: "contract" | "deal"; frame?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function NewRoute() {
  const { type, frame } = Route.useSearch();
  return type === "deal" ? (
    <DealNewPage {...(frame ? { frameId: frame } : {})} />
  ) : (
    <NewContractPage />
  );
}

export const Route = createFileRoute("/_authed/contracts/new")({
  validateSearch: (s: Record<string, unknown>): NewSearch => ({
    ...(s.type === "deal" || s.type === "contract" ? { type: s.type } : {}),
    ...(typeof s.frame === "string" && UUID.test(s.frame) ? { frame: s.frame } : {}),
  }),
  component: NewRoute,
});
