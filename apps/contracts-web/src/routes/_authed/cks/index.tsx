// PK-FR-10 · HD-FR-97 · S10 · nav-v2: /cks → tab "Sản phẩm CKS" của /products (giữ `?filter=` / `?lot=`); chi tiết khách vẫn ở /cks/$id.
import { createFileRoute, redirect } from "@tanstack/react-router";

const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.length <= 200 ? v : undefined;

export const Route = createFileRoute("/_authed/cks/")({
  validateSearch: (s: Record<string, unknown>): { filter?: string; lot?: string } => ({
    ...(text(s.filter) ? { filter: text(s.filter) } : {}),
    ...(text(s.lot) ? { lot: text(s.lot) } : {}),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/products", search: { tab: "cks", ...search }, replace: true });
  },
});
