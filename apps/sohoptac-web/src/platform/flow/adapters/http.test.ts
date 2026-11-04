// CR-118 · cr118-flow-web · adapter HTTP của FlowRuntime (web-kit thật, fetch giả): đường dẫn kit, 404 (cờ tắt) ⇒ null, summary nhớ khe tắt.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApiError, setAuthHooks } from "@ai/web-kit/http";
import { httpFlowRuntime } from "./http";

type Call = { path: string; method: string; body: unknown };
const realFetch = globalThis.fetch;
let calls: Call[] = [];
let status = 200;
let json: unknown = {};

beforeEach(() => {
  calls = [];
  status = 200;
  json = {};
  setAuthHooks({ getToken: () => "t", refresh: async () => null });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      path: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const body = status === 200 ? json : { error: { code: "NOT_FOUND", message: "x" } };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setAuthHooks(null);
});

const U = "4d400000-0000-4000-8000-000000000001";
const tail = (c: Call | undefined) => c?.path.replace(/^https?:\/\/[^/]+/, "");

describe("httpFlowRuntime", () => {
  test("view ⇒ GET /pack/<gói>/flow/<khe>/<ref> · 404 ⇒ null · lỗi khác ném", async () => {
    const rt = httpFlowRuntime();
    json = { ref: "r1" };
    expect(await rt.view("contracts.approval", "r1")).toEqual({ ref: "r1" } as never);
    expect(tail(calls[0])).toBe("/pack/contracts/flow/contracts.approval/r1");
    status = 404;
    expect(await rt.view("contracts.approval", "r1")).toBeNull();
    status = 500;
    await expect(rt.view("contracts.approval", "r1")).rejects.toBeInstanceOf(ApiError);
  });

  test("act ⇒ POST …/tasks/:id/actions/:action với thân", async () => {
    await httpFlowRuntime().act("contracts.approval", "r1", U, "approve", { feedback: "ok" });
    expect(tail(calls[0])).toBe(
      `/pack/contracts/flow/contracts.approval/r1/tasks/${U}/actions/approve`,
    );
    expect([calls[0]?.method, calls[0]?.body]).toEqual(["POST", { feedback: "ok" }]);
  });

  test("submitForm ⇒ POST /review-tasks/:id/form {values} (đường sẵn có, không đổi server)", async () => {
    await httpFlowRuntime().submitForm(U, { name: "A", qty: 2 });
    expect(tail(calls[0])).toBe(`/review-tasks/${U}/form`);
    expect([calls[0]?.method, calls[0]?.body]).toEqual(["POST", { values: { name: "A", qty: 2 } }]);
  });

  test("summary ⇒ một POST cho cả lô · 404 (runtime tắt) ⇒ null và KHÔNG gọi lại ở lần sau", async () => {
    json = { slot: "contracts.approval", items: [] };
    await httpFlowRuntime().summary("contracts.approval", ["a", "b", "c"]);
    expect(calls).toHaveLength(1);
    expect(tail(calls[0])).toBe("/pack/contracts/flow/contracts.approval/summary");
    expect(calls[0]?.body).toEqual({ refs: ["a", "b", "c"] });
    calls = [];
    const off = httpFlowRuntime();
    status = 404;
    expect(await off.summary("contracts.approval", ["a"])).toBeNull();
    expect(await off.summary("contracts.approval", ["b"])).toBeNull();
    expect(calls).toHaveLength(1); // đúng 1 yêu cầu 404; lần hai không đi mạng
  });

  test("summary rỗng ⇒ không gọi mạng", async () => {
    expect(await httpFlowRuntime().summary("contracts.approval", [])).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
