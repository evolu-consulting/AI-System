// Proxy UAT trước mock GitHub (:4040): :4041, chế độ đổi qua GET /__mode?m=ok|rate|err500|auth401|nopr  (chỉ để UAT tạo lỗi nhà cung cấp).
import http from "node:http";
let mode = "ok";
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__mode") { mode = u.searchParams.get("m") ?? "ok"; res.end(mode); return; }
  const send = (code, body, h = {}) => { res.writeHead(code, { "content-type": "application/json", ...h }); res.end(JSON.stringify(body)); };
  if (mode === "rate") return send(403, { message: "API rate limit exceeded", documentation_url: "x" }, { "x-ratelimit-remaining": "0", "retry-after": "2" });
  if (mode === "err500") return send(502, { message: "Bad gateway" });
  if (mode === "auth401") return send(401, { message: "Bad credentials" });
  const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => {
    const p = http.request({ host: "127.0.0.1", port: 4040, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.end(Buffer.concat(chunks));
  });
}).listen(4041, "127.0.0.1", () => console.log("ghproxy :4041 -> :4040"));
