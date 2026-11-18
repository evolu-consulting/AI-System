// CR-182 · R7 · route /contracts/verify — «Kiểm tra tệp».
import { createFileRoute } from "@tanstack/react-router";
import { VerifyFilePage } from "~/features/verify-file/VerifyFilePage";

export const Route = createFileRoute("/_authed/contracts/verify")({
  component: VerifyFilePage,
});
