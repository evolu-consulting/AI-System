// UAT P-d2 · Dify giả (SSE `workflow_finished` như Dify streaming) cho stage `tool` (Node thuần, cổng 5390). POST /v1/workflows/run đọc hàng đợi kịch bản
// (POST /__q {"q":["ok:25000000","http503","http400","badjson","hang"]}); hết hàng đợi ⇒ lặp lại tong_tien từ inputs.
// GET /__calls ⇒ số lời gọi + inputs cuối; POST /__reset xoá. Không phải secret thật, không ra mạng.
import { createServer } from "node:http";

const q = [];
const calls = [];
const body = (req) =>
  new Promise((ok) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => ok(b ? JSON.parse(b) : {}));
  });
const sse = (res, o) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ event: "workflow_started", task_id: "uat-task", data: { id: "uat-wfr" } })}\n\n`);
  res.end(`data: ${JSON.stringify({ event: "workflow_finished", task_id: "uat-task", data: o.data })}\n\n`);
};
const send = (res, code, o) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(o));
};
const okOut = (inputs, tong) => ({
  workflow_run_id: "uat-wfr",
  task_id: "uat-task",
  data: {
    id: "uat-wfr",
    workflow_id: "uat-wf",
    status: "succeeded",
    outputs: { result: JSON.stringify({ so_hd: "HD-0001", tong: tong ?? Number(inputs.tong_tien ?? 0) }) },
    error: null,
    elapsed_time: 0.05,
    total_tokens: 0,
    total_steps: 1,
    created_at: 1767225600,
    finished_at: 1767225601,
  },
});

createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__q" && req.method === "POST") {
    q.push(...((await body(req)).q ?? []));
    return send(res, 200, { q });
  }
  if (u.pathname === "/__calls") return send(res, 200, { n: calls.length, calls });
  if (u.pathname === "/__reset") {
    q.length = 0;
    calls.length = 0;
    return send(res, 200, {});
  }
  if (u.pathname === "/v1/workflows/run" && req.method === "POST") {
    const b = await body(req);
    calls.push({ at: new Date().toISOString(), inputs: b.inputs });
    const step = q.shift() ?? "echo";
    if (step === "http503") return send(res, 503, { code: "unavailable", message: "uat 503" });
    if (step === "http400") return send(res, 400, { code: "invalid_param", message: "uat 400" });
    if (step === "badjson") {
      const o = okOut(b.inputs);
      o.data.outputs.result = "khong phai json";
      return sse(res, o);
    }
    if (step === "hang") return; // không trả lời ⇒ TIMEOUT phía Hub
    if (step.startsWith("ok:")) return sse(res, okOut(b.inputs ?? {}, Number(step.slice(3))));
    return sse(res, okOut(b.inputs ?? {}));
  }
  send(res, 404, { code: "not_found" });
}).listen(5390, "127.0.0.1", () => console.log("[fake-dify] :5390"));

