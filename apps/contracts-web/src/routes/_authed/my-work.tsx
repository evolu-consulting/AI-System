// W1: /my-work — "Việc của tôi".
import { createFileRoute } from "@tanstack/react-router";
import { MyWorkPage } from "~/features/mywork/pages/MyWorkPage";

export const Route = createFileRoute("/_authed/my-work")({ component: MyWorkPage });
