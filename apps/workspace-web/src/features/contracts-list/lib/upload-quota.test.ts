import { describe, expect, test } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import type { UploadItem } from "./upload-queue";
import { formatResetsAt, quotaNotice, quotaPopupText, stopOnQuota } from "./upload-quota";

const t = (k: string, o?: Record<string, unknown>) => (o ? `${k}|${JSON.stringify(o)}` : k);
const quota = (details?: unknown) =>
  new ApiError(429, "UPLOAD_QUOTA" as never, "q", details === undefined ? {} : { details });
const P = "contracts.list.upload.quotaPopup";

describe("quotaNotice", () => {
  test("đọc scope/limit/resets_at; lỗi khác ⇒ null; details hỏng ⇒ rỗng", () => {
    expect(
      quotaNotice(quota({ scope: "tenant", limit: 5, resets_at: "2026-10-28T00:00:00Z" })),
    ).toEqual({
      scope: "tenant",
      limit: 5,
      resetsAt: "2026-10-28T00:00:00Z",
    });
    expect(quotaNotice(new ApiError(500, "INTERNAL" as never, "x"))).toBeNull();
    expect(quotaNotice(new Error("x"))).toBeNull();
    expect(quotaNotice(quota({ scope: "x", limit: "5", resets_at: "bad" }))).toEqual({
      scope: undefined,
      limit: undefined,
      resetsAt: undefined,
    });
  });
});

describe("quotaPopupText", () => {
  const at = "2026-10-27T17:30:00Z"; // 00:30 ngày 28/10 giờ VN
  test("formatResetsAt theo múi giờ", () => {
    expect(formatResetsAt(at, "vi", "Asia/Ho_Chi_Minh")).toEqual({ time: "00:30", date: "28/10" });
  });
  test("scope tenant / global chọn đúng câu, kèm số + giờ", () => {
    const tenant = quotaPopupText({ scope: "tenant", limit: 20, resetsAt: at }, t, "vi", "UTC");
    expect(tenant.title).toBe(`${P}.title`);
    expect(tenant.body).toBe(`${P}.tenant|{"limit":20,"time":"17:30","date":"27/10"}`);
    expect(
      quotaPopupText({ scope: "global", limit: 9, resetsAt: at }, t, "vi", "UTC").body,
    ).toStartWith(`${P}.global|`);
  });
  test("thiếu details ⇒ câu chung không số/giờ", () => {
    expect(quotaPopupText({}, t).body).toBe(`${P}.generic`);
    expect(quotaPopupText({ scope: "tenant", limit: 3 }, t).body).toBe(`${P}.generic`);
  });
});

describe("stopOnQuota", () => {
  const it = (key: number, state: UploadItem["state"]): UploadItem => ({
    key,
    name: `f${key}`,
    size: 1,
    state,
  });
  test("tệp lỗi + tệp queued ⇒ error không retry; tệp xong giữ nguyên", () => {
    const out = stopOnQuota(
      [it(1, "done"), it(2, "uploading"), it(3, "queued"), it(4, "queued")],
      2,
      "Q",
    );
    expect(out[0]?.state).toBe("done");
    for (const i of out.slice(1))
      expect(i).toMatchObject({ state: "error", error: "Q", retryable: false });
  });
});
