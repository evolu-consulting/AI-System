// ADM-FR-65 · lời dò engine dùng chung key cho 3 observer (nav, route gate, cảnh báo chế độ admin). Observer gắn sau cùng quyết
// tuỳ chọn của lần fetch kế ⇒ observer "chỉ đọc" thiếu `queryFn` từng làm retry/refetch lỗi "No queryFn" ⇒ nav ẩn "Quy trình".
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { engineProbeOptions, PROCESS_ENGINE_KEY } from "./engine";

describe("engineProbeOptions", () => {
  test("mọi observer cùng key, cùng queryFn (kể cả enabled=false)", () => {
    const on = engineProbeOptions(true);
    const off = engineProbeOptions(false);
    expect(off.queryKey).toEqual(PROCESS_ENGINE_KEY);
    expect(off.queryFn).toBe(on.queryFn);
    expect([on.enabled, off.enabled]).toEqual([true, false]);
  });

  test("observer chỉ đọc gắn sau ⇒ refetch vẫn chạy queryFn, không rơi vào lỗi", async () => {
    // `bun test` cả repo có thể đặt PUBLIC_HUB_URL (cùng tiến trình với e2e/stack) ⇒ lời dò sẽ gọi mạng: giả fetch 200 để kết quả
    // không phụ thuộc môi trường (không URL ⇒ lời dò trả "off" mà không gọi fetch).
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const nav = new QueryObserver(client, engineProbeOptions(true));
    const stopNav = nav.subscribe(() => {});
    await client.fetchQuery(engineProbeOptions(true));
    const gate = new QueryObserver(client, engineProbeOptions(false));
    const stopGate = gate.subscribe(() => {});
    await client.refetchQueries({ queryKey: PROCESS_ENGINE_KEY });
    const q = client.getQueryState(PROCESS_ENGINE_KEY);
    stopGate();
    stopNav();
    client.clear();
    globalThis.fetch = realFetch;
    // Không có PUBLIC_HUB_URL trong test ⇒ lời dò trả "off" ngay (không gọi mạng); điều cần là KHÔNG lỗi.
    expect({ status: q?.status, error: q?.error ?? null }).toEqual({
      status: "success",
      error: null,
    });
  });
});
