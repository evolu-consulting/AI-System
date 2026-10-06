// X1 ST1 · test riêng của backend cho `combine.rules.ts` (ngoài AC19 của QC): webEnv bỏ token, token lấy từ base,
// toWslPath, script WSL, CORS không trùng lặp.
import { describe, expect, it } from "bun:test";
import {
  buildCombineEnv,
  newInternalToken,
  START_ORDER,
  stopOrder,
  toWslPath,
  URLS,
  webEnv,
  wslRuntimeScript,
} from "./combine.rules";

describe("combine.rules", () => {
  it("token: opts.token > base.HUB_INTERNAL_TOKEN > sinh mới; chuỗi rỗng coi như vắng", () => {
    const base = { HUB_INTERNAL_TOKEN: "from-env-local-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" };
    expect(buildCombineEnv(base, { token: "opt" })["admin-api"].HUB_INTERNAL_TOKEN).toBe("opt");
    expect(buildCombineEnv(base)["hub-api"].HUB_INTERNAL_TOKEN).toBe(base.HUB_INTERNAL_TOKEN);
    const gen = buildCombineEnv({ HUB_INTERNAL_TOKEN: "" }, { token: "  " })["admin-api"]
      .HUB_INTERNAL_TOKEN;
    expect(gen).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect(newInternalToken()).not.toBe(newInternalToken());
  });

  it("env không chép base (chỉ phần ghi đè) và hub-api luôn HUB_DEV_RUNTIME=none", () => {
    const e = buildCombineEnv({ SECRET_MASTER_KEY: "s", HUB_DEV_RUNTIME: "local" });
    for (const p of START_ORDER) expect(e[p].SECRET_MASTER_KEY).toBeUndefined();
    expect(e["hub-api"].HUB_DEV_RUNTIME).toBe("none");
    expect(e["dify-mock"].PORT).toBe("5001");
  });
});

describe("combine.rules · webEnv + tiện ích", () => {
  it("webEnv: danh sách trắng (bỏ token/secret/DB URL), giữ PUBLIC_*, overlay thắng", () => {
    const out = webEnv(
      {
        PATH: "/bin",
        PUBLIC_X: "p",
        HUB_INTERNAL_TOKEN: "tok",
        SEED_ADMIN_PASSWORD: "pw",
        DATABASE_URL: "postgres://owner",
        SECRET_MASTER_KEY: "k",
        HUB_URL: "x",
        GONE: undefined,
      },
      { HUB_URL: URLS.hub },
    );
    expect(out).toEqual({ PATH: "/bin", PUBLIC_X: "p", HUB_URL: "http://localhost:4000" });
  });

  it("stopOrder bỏ tên lặp, không đổi mảng gốc", () => {
    const s = ["admin-api", "hub-api", "hub-api", "chat-web"] as const;
    expect(stopOrder(s)).toEqual(["chat-web", "hub-api", "admin-api"]);
    expect(s[0]).toBe("admin-api");
  });

  it("toWslPath: ổ Windows → /mnt/<ổ>, POSIX giữ nguyên", () => {
    expect(toWslPath("D:\\AI\\ai-system")).toBe("/mnt/d/AI/ai-system");
    expect(toWslPath("C:/x/y/")).toBe("/mnt/c/x/y");
    expect(toWslPath("/home/u/repo")).toBe("/home/u/repo");
  });

  it("script WSL: provider claude-sub,dify + Hub localhost:4000, không chứa token", () => {
    const s = wslRuntimeScript("/mnt/d/r");
    expect(s).toContain("AGENT_RT_PROVIDERS=claude-sub,dify");
    expect(s).toContain("AGENT_RT_HUB_URL=http://localhost:4000");
    expect(s).toContain("cd /mnt/d/r/apps/agent-runtime");
    expect(s).not.toContain("HUB_INTERNAL_TOKEN");
  });
});
