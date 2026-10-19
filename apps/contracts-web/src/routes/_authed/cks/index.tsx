// PK-FR-10 · HD-FR-97 · S10: /cks — sản phẩm chữ ký số (HD9).
import { createFileRoute } from "@tanstack/react-router";
import { CksPage } from "~/features/cks/pages/CksPage";

export const Route = createFileRoute("/_authed/cks/")({ component: CksPage });
