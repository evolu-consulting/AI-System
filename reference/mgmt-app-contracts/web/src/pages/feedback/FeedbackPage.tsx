import { useEffect } from "react";
import { Navigate } from "react-router";
import { openFeedback } from "@/feedback/FeedbackDialog";

/** Góp ý is a popup now (FeedbackDialog); an old /feedback link opens it over the contracts page. */
export default function FeedbackPage() {
  useEffect(() => { setTimeout(openFeedback, 0); }, []);
  return <Navigate to="/contracts" replace />;
}
