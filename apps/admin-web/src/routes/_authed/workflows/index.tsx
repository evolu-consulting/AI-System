// ADM-FR-10 · M2 · route danh sách Workflows (stub FE1a; FE4a thay bằng màn thật). `validateSearch` có sẵn để các màn khác
// (Secrets: "Xem các workflow dùng secret này") điều hướng kèm `?secret=`.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformOnly } from "@/components/shared/PlatformOnly";

export type WorkflowsSearch = {
  q?: string;
  status?: "on" | "off" | "unattached";
  secret?: string;
  page?: number;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

function Stub() {
  const { t } = useTranslation();
  return (
    <PlatformOnly>
      <PageHeader title={t("workflows.list.title")} />
    </PlatformOnly>
  );
}

export const Route = createFileRoute("/_authed/workflows/")({
  validateSearch: (s: Record<string, unknown>): WorkflowsSearch => {
    const page = Number(s.page);
    const status = ["on", "off", "unattached"].find((x) => x === s.status) as
      | WorkflowsSearch["status"]
      | undefined;
    return {
      q: str(s.q),
      status,
      secret: str(s.secret),
      page: Number.isInteger(page) && page > 1 ? page : undefined,
    };
  },
  component: Stub,
});
