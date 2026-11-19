// fix-cr191-community-e2e · `postState` với id không phải UUID (undefined từ người gọi sai chữ ký) ⇒ null, KHÔNG chạy SQL vỡ (`where id = ::uuid`).
import { describe, expect, test } from "bun:test";
import type { Tx } from "@ai/db";
import { postState } from "./post-write.repo";

describe("postState", () => {
  test("id không phải UUID (undefined / chuỗi rỗng / chữ) ⇒ null, không gọi SQL", async () => {
    let calls = 0;
    const tx = { execute: async () => (calls++, []) } as unknown as Tx;
    for (const id of [undefined, "", "abc"])
      expect(await postState(tx, id as unknown as string)).toBeNull();
    expect(calls).toBe(0);
  });
});
