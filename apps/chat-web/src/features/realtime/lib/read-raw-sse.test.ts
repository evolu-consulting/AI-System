// HUB-FR-99 · readRawSse: `onBytes` cho cả `: ping`, khung cắt giữa chunk vẫn ghép đúng, signal huỷ thì dừng.
import { expect, test } from "bun:test";
import type { RawSseEvent } from "@ai/contracts/chat";
import { readRawSse } from "./read-raw-sse";

const enc = new TextEncoder();
const streamOf = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      c.close();
    },
  });

test("ping báo byte nhưng không phát khung; khung cắt đôi được ghép", async () => {
  const got: RawSseEvent[] = [];
  let bytes = 0;
  await readRawSse(
    streamOf([": ping\n\n", "id: 1-0\nevent: room.dele", 'ted\ndata: {"a":1}\n\n']),
    (e) => got.push(e),
    () => bytes++,
  );
  expect(bytes).toBe(3);
  expect(got).toEqual([{ id: "1-0", event: "room.deleted", data: '{"a":1}' }]);
});

test("signal đã huỷ → trả về sớm", async () => {
  const ac = new AbortController();
  ac.abort();
  const never = new ReadableStream<Uint8Array>({});
  await readRawSse(
    never,
    () => {},
    () => {},
    ac.signal,
  );
});
