// AC-H47 · PD2-E05: tool lõi `open` (app-guide, my-*) không được lọt vào catalog "Gọi tool" của công ty chưa bật tool nào.
import { describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import type {
  PackToolCatalog,
  PackToolInfo,
} from "../../../packs/kit/application/pack-tools.ports";
import { toolSwitchReader } from "./tool-switch.repo";

const info = (key: string, open: boolean): PackToolInfo => ({
  key,
  name: key,
  description: "",
  sideEffect: false,
  ...(open ? { open: true } : {}),
  params: [],
});
const packs = {
  available: async () => [info("app-guide", true), info("contracts-find", false)],
} as unknown as PackToolCatalog;
const tx = { execute: async () => [] } as unknown as Tx;

describe("toolSwitchReader · tool lõi", () => {
  it("công ty chưa bật workflow nào: không có tool lõi; tool gói bật vẫn có", async () => {
    const r = await toolSwitchReader(tx, "t1", packs).available();
    expect(r.map((t) => t.key)).toEqual(["contracts-find"]);
    const none = await toolSwitchReader(tx, "t1", {
      available: async () => [info("app-guide", true)],
    } as unknown as PackToolCatalog).available();
    expect(none).toEqual([]);
  });
});
