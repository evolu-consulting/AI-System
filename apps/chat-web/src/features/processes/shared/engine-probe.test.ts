// Demo · cờ đóng băng tắt ⇒ không dò `GET /processes` (không 404 trong console).
// `bun test` cả repo chạy chung tiến trình với biến của stack e2e (`PUBLIC_FROZEN_MODULES=on` có thể rò vào) ⇒ mỗi ca chỉ chạy khi
// cờ build đúng với tiền đề của nó, và ca "bật" giả fetch để không phụ thuộc mạng.
import { describe, expect, it } from "bun:test";
import { frozenModulesOn } from "~/lib/frozen";
import { probeEngine } from "./api";

const withFetch = async (impl: () => Promise<Response>, run: () => Promise<void>) => {
  const orig = globalThis.fetch;
  globalThis.fetch = impl as unknown as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = orig;
  }
};

describe("probeEngine", () => {
  it.skipIf(frozenModulesOn)("module đóng băng tắt ⇒ off, không gọi mạng", async () => {
    let calls = 0;
    await withFetch(
      () => {
        calls++;
        return Promise.reject(new Error("không được gọi"));
      },
      async () => {
        expect(await probeEngine()).toBe("off");
        expect(calls).toBe(0);
      },
    );
  });

  it.skipIf(!frozenModulesOn)(
    "module đóng băng bật ⇒ dò /processes: 200 ⇒ on, 404 ⇒ off",
    async () => {
      await withFetch(
        () => Promise.resolve(new Response("{}", { status: 200 })),
        async () => expect(await probeEngine()).toBe("on"),
      );
      await withFetch(
        () => Promise.resolve(new Response("{}", { status: 404 })),
        async () => expect(await probeEngine()).toBe("off"),
      );
    },
  );
});
