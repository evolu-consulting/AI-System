// CR-181 · s12 — /contracts/sign/$id: màn ký toàn màn hình (chuẩn bị chỗ ký / ký). s13 thêm nút mở tới đây.
import { createFileRoute } from "@tanstack/react-router";
import { SignScreen } from "~/features/doc-sign/pages/SignScreen";

function SignRoute() {
  const { id } = Route.useParams();
  return <SignScreen id={id} />;
}

export const Route = createFileRoute("/_authed/contracts/sign/$id")({ component: SignRoute });
