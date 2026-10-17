/** The browser's part of the activity log (api/app/audit.py): pages opened and errors hit. Best-effort: never in the
 *  way of the page. Reading the log is for the team running the app only (/admin/logs), so nothing here reads it. */
export function logUi(type: "view" | "error", path: string, message?: string, stack?: string) {
  void fetch("/api/logs/ui", { method: "POST", credentials: "include", keepalive: true, headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, path: path.slice(0, 500), message: message?.slice(0, 2000), stack: stack?.slice(0, 6000) }) })
    .catch(() => undefined);
}