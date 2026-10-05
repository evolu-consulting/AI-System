import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { scenarioOf, startDifyMock, uploadDirectiveOf } from "./dify-mock";

const m = startDifyMock({ allowBlocking: true });
afterAll(() => m.close());
beforeEach(() => m.reset());

type Rec = { requests: { auth: string; body: { user: string } }[] };
const post = (path: string, key: string, body: object) =>
  fetch(`${m.url}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const stream = { response_mode: "streaming", user: "u1", inputs: { a: 1 } };
async function events(r: Response): Promise<string[]> {
  const t = await r.text();
  return [...t.matchAll(/^event: (\w+)$/gm)].map((x) => x[1] as string);
}

describe("dify-mock", () => {
  test("scenarioOf", () => {
    expect(scenarioOf("LEAK_KEY_abc").kind).toBe("ok");
    expect(scenarioOf("mk-slow-50")).toEqual({ kind: "slow", ms: 50 });
    expect(scenarioOf("mk-503x2")).toEqual({ kind: "flaky", times: 2 });
  });

  test("workflow ok streaming và ghi request", async () => {
    const ev = await events(await post("/v1/workflows/run", "mk-ok", stream));
    expect(ev.filter((e) => e === "text_chunk")).toHaveLength(5);
    expect(ev.at(-1)).toBe("workflow_finished");
    const rec = (await (await fetch(`${m.url}/__mock/requests`)).json()) as Rec;
    expect(rec.requests[0]?.auth).toBe("Bearer mk-ok");
    expect(rec.requests[0]?.body.user).toBe("u1");
    expect(m.calls()[0]?.path).toBe("/v1/workflows/run");
  });

  test("blocking, và từ chối khi tắt allowBlocking", async () => {
    const r = await post("/v1/workflows/run", "mk-ok", { response_mode: "blocking", user: "u" });
    expect(((await r.json()) as { data: { status: string } }).data.status).toBe("succeeded");
    const strict = startDifyMock();
    const r2 = await fetch(`${strict.url}/v1/workflows/run`, {
      method: "POST",
      body: JSON.stringify({ response_mode: "blocking" }),
    });
    expect(r2.status).toBe(400);
    await strict.close();
  });
});

describe("dify-mock kịch bản", () => {
  test("failed, error-event, outputs, agent, usage", async () => {
    const f = await (await post("/v1/workflows/run", "mk-failed", stream)).text();
    expect(f).toContain('"status":"failed"');
    const err = await events(await post("/v1/workflows/run", "mk-error-event", stream));
    expect(err).toContain("error");
    const out = await events(await post("/v1/workflows/run", "mk-outputs", stream));
    expect(out).not.toContain("text_chunk");
    const a = await events(await post("/v1/chat-messages", "mk-agent", stream));
    expect(a).toContain("agent_thought");
    expect(a).toContain("agent_message");
    const u = await (await post("/v1/chat-messages", "mk-ok", stream)).text();
    expect(u).toContain("total_tokens");
  });

  test("http lỗi và 503x2 đếm theo key", async () => {
    expect((await post("/v1/workflows/run", "mk-401", stream)).status).toBe(401);
    expect((await post("/v1/workflows/run", "mk-404", stream)).status).toBe(404);
    const s: number[] = [];
    for (let i = 0; i < 3; i++)
      s.push((await post("/v1/workflows/run", "mk-503x2", stream)).status);
    expect(s).toEqual([503, 503, 200]);
  });

  test("slow: stop kết thúc stream với stopped", async () => {
    const r = await post("/v1/workflows/run", "mk-slow-80", stream);
    const text = r.text();
    await new Promise((x) => setTimeout(x, 100));
    const st = await post("/v1/workflows/tasks/task-1/stop", "mk-slow-80", { user: "u1" });
    expect(((await st.json()) as { result: string }).result).toBe("success");
    const t = await text;
    expect(t).toContain('"status":"stopped"');
    expect((t.match(/text_chunk/g) ?? []).length).toBeLessThan(5);
  });

  test("parameters", async () => {
    const r = await fetch(`${m.url}/v1/parameters`, { headers: { authorization: "Bearer mk-ok" } });
    expect(r.status).toBe(200);
  });
});

// ---------- H2c MK-U: /v1/files/upload ----------
type UploadBody = {
  user: string | null;
  file: { name: string; type: string; size: number; sha256: string } | null;
};
const up = (name: string | null, key = "mk-ok", type = "application/pdf") => {
  const fd = new FormData();
  fd.set("user", "acme:u1");
  if (name !== null)
    fd.set("file", new File([new Uint8Array([37, 80, 68, 70, 45, 49])], name, { type }));
  return fetch(`${m.url}/v1/files/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: fd,
  });
};

describe("dify-mock /v1/files/upload (H2c MK-U)", () => {
  test("201 id upl-<n> + ghi multipart (user, tên, type, size, sha256)", async () => {
    const r = await up("hoadon.pdf");
    expect(r.status).toBe(201);
    const b = (await r.json()) as Record<string, unknown>;
    expect(b).toMatchObject({ id: "upl-1", name: "hoadon.pdf", size: 6, extension: "pdf" });
    expect(b.mime_type).toBe("application/pdf");
    expect(((await (await up("b.png", "mk-ok", "image/png")).json()) as { id: string }).id).toBe(
      "upl-2",
    );
    const c = m.calls()[0];
    expect(c?.path).toBe("/v1/files/upload");
    expect(c?.auth).toBe("Bearer mk-ok");
    const body = c?.body as UploadBody;
    expect(body.user).toBe("acme:u1");
    expect(body.file).toEqual({
      name: "hoadon.pdf",
      type: "application/pdf",
      size: 6,
      sha256: new Bun.CryptoHasher("sha256")
        .update(new Uint8Array([37, 80, 68, 70, 45, 49]))
        .digest("hex"),
    });
  });

  test("chỉ thị theo tên file: 413/415/400-too-large/500/noid/slow", async () => {
    expect(uploadDirectiveOf("upload-slow-80-a.pdf")).toEqual({ kind: "slow", ms: 80 });
    const st = async (n: string) => {
      const r = await up(n);
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    };
    expect((await st("upload-413-a.pdf")).body.code).toBe("file_too_large");
    expect((await st("upload-413-a.pdf")).status).toBe(413);
    const u415 = await st("upload-415.pdf");
    expect([u415.status, u415.body.code]).toEqual([415, "unsupported_file_type"]);
    const b400 = await st("upload-400-too-large.pdf");
    expect([b400.status, b400.body.code]).toEqual([400, "file_too_large"]);
    expect((await st("upload-500.pdf")).status).toBe(500);
    const noid = await st("upload-noid.pdf");
    expect(noid.status).toBe(201);
    expect("id" in noid.body).toBe(false);
    const t0 = Date.now();
    expect((await st("upload-slow-120-x.pdf")).status).toBe(201);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });
});

describe("dify-mock /v1/files/upload lỗi + tương thích (H2c MK-U)", () => {
  test("key mk-401/404/400 → status như workflow; thiếu file → 400 no_file_uploaded; mọi lần đều ghi", async () => {
    expect((await up("a.pdf", "mk-401")).status).toBe(401);
    expect((await up("a.pdf", "mk-404")).status).toBe(404);
    expect((await up("a.pdf", "mk-400")).status).toBe(400);
    const r = await up(null);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { code: string }).code).toBe("no_file_uploaded");
    expect(m.calls().filter((c) => c.path === "/v1/files/upload")).toHaveLength(4);
  });

  test("JSON workflow cũ không đổi sau upload; reset đặt lại bộ đếm upl", async () => {
    await up("a.pdf");
    const ev = await events(await post("/v1/workflows/run", "mk-ok", stream));
    expect(ev.at(-1)).toBe("workflow_finished");
    expect((m.calls().at(-1)?.body as { inputs?: unknown } | undefined)?.inputs).toEqual({ a: 1 });
    m.reset();
    expect(((await (await up("c.pdf")).json()) as { id: string }).id).toBe("upl-1");
  });
});
