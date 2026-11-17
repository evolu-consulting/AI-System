// CR-181 · s14 — /contracts/signed/$id?file=&v=: xem bản đã ký (chỉ đọc). s13 thêm liên kết mở tới đây.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SignedScreen } from "~/features/doc-sign/pages/SignedScreen";

type Search = { file?: string; v?: string };

function SignedRoute() {
  const { id } = Route.useParams();
  const { file, v } = Route.useSearch();
  const nav = useNavigate();
  return (
    <SignedScreen
      id={id}
      file={file}
      v={v}
      onNav={(n) =>
        void nav({ to: "/contracts/signed/$id", params: { id }, search: n, replace: true })
      }
      onBack={() => void nav({ to: "/contracts/c/$id", params: { id } })}
    />
  );
}

export const Route = createFileRoute("/_authed/contracts/signed/$id")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    file: typeof s.file === "string" ? s.file : undefined,
    v: typeof s.v === "string" ? s.v : undefined,
  }),
  component: SignedRoute,
});
