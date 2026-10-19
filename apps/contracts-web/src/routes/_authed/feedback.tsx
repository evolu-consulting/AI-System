// PK-FR-10 · TF5 · `/feedback` (đường cũ của mgmt-app): mở khoang góp ý rồi về `/contracts` (khoang rỗng ở N1, D-23).
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { FEEDBACK_OPEN } from "~/features/shell/hooks/use-dock";

function FeedbackRoute() {
  useEffect(() => {
    window.dispatchEvent(new Event(FEEDBACK_OPEN));
  }, []);
  return <Navigate to="/contracts" replace />;
}

export const Route = createFileRoute("/_authed/feedback")({ component: FeedbackRoute });
