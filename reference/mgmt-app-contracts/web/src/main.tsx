import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Roboto (Google Fonts, bundled here): familiar from Google's own apps and complete for Vietnamese diacritics.
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/roboto-mono/400.css";
import "./index.css";
import App from "./app/App";
import { logUi } from "./api/logs";

// Trial phase: errors the page hits go to the activity log with their stack, so a report can be traced.
window.addEventListener("error", (e) => logUi("error", location.pathname + location.search, String(e.message), e.error?.stack));
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason as { message?: string; stack?: string } | undefined;
  logUi("error", location.pathname + location.search, r?.message ?? String(e.reason), r?.stack);
});

const qc = new QueryClient({
  defaultOptions: {
    // A 404 from a route the backend has not shipped yet should show an empty state, not hammer the server.
    queries: { retry: (n, e) => n < 1 && !(e && "status" in e && (e as { status: number }).status < 500), refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter><App /></BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
