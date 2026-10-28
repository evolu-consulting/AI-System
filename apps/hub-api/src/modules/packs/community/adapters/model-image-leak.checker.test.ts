// COM-C11a: contract adapter model với transport giả — không gọi model thật.
import { describe, expect, test } from "bun:test";
import { fakeImageLeakChecker } from "./fake-image-leak.checker";
import {
  createModelImageLeakChecker,
  IMAGE_CHECK_PROMPT,
  type VisionRequest,
  type VisionTransport,
} from "./model-image-leak.checker";

const img = { mediaType: "image/png" as const, bytes: new Uint8Array([1, 2, 3]) };
const reply = (text: string): VisionTransport => ({ complete: async () => ({ ok: true, text }) });

describe("createModelImageLeakChecker", () => {
  test("gửi ảnh base64 + prompt OCR, map kết quả", async () => {
    const seen: VisionRequest[] = [];
    const t: VisionTransport = {
      complete: async (r) => {
        seen.push(r);
        return { ok: true, text: JSON.stringify({ text: "0912345678", logos: [], companies: [] }) };
      },
    };
    const r = await createModelImageLeakChecker({ transport: t, model: "vision-x" }).check(img);
    expect(seen[0]?.image).toEqual({ mediaType: "image/png", base64: "AQID" });
    expect(seen[0]?.prompt).toBe(IMAGE_CHECK_PROMPT);
    expect(seen[0]?.model).toBe("vision-x");
    expect(r.status).toBe("suspect");
  });
  test("không model / transport lỗi / ném / đầu ra hỏng ⇒ unknown", async () => {
    const mk = (transport: VisionTransport | null) =>
      createModelImageLeakChecker({ transport, model: "m" });
    expect((await mk(null).check(img)).status).toBe("unknown");
    expect((await mk({ complete: async () => ({ ok: false }) }).check(img)).status).toBe("unknown");
    expect(
      (
        await mk({
          complete: async () => {
            throw new Error("x");
          },
        }).check(img)
      ).status,
    ).toBe("unknown");
    expect((await mk(reply("???")).check(img)).status).toBe("unknown");
  });
  test("hết giờ ⇒ unknown, không treo", async () => {
    const hang: VisionTransport = { complete: () => new Promise(() => {}) };
    const t0 = Date.now();
    const r = await createModelImageLeakChecker({
      transport: hang,
      model: "m",
      timeoutMs: 30,
    }).check(img);
    expect(r.status).toBe("unknown");
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  test("adapter giả ghi lại lời gọi", async () => {
    const f = fakeImageLeakChecker({
      status: "suspect",
      findings: [{ kind: "logo", confidence: 0.9 }],
    });
    expect((await f.check(img, { otherCompanies: ["A"] })).status).toBe("suspect");
    expect(f.calls).toHaveLength(1);
  });
});
