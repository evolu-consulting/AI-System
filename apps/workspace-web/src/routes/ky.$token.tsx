// CR-182 · `/ky/$token`: trang ký CÔNG KHAI của đối tác (link riêng trong email). Ngoài `_authed`: không đăng nhập, không khung app.
import { createFileRoute } from "@tanstack/react-router";
import { PartnerSignPage } from "~/features/partner-sign/pages/PartnerSignPage";

function Page() {
  const { token } = Route.useParams();
  return <PartnerSignPage token={token} />;
}

export const Route = createFileRoute("/ky/$token")({ component: Page });
