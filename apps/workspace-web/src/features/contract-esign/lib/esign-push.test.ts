import { describe, expect, it } from "bun:test";
import { parseMeStreamProcessEvent } from "@ai/contracts/chat";
import { ESIGN_QUERY_OPTS, eventConcernsEsign } from "./esign-push";

const CID = "0f3c2a10-8b1e-4c55-9d7a-1a2b3c4d5e6f";
const ev = (event: string, data: unknown) => {
  const e = parseMeStreamProcessEvent(event, JSON.stringify(data));
  if (!e) throw new Error("event không hợp lệ");
  return e;
};

describe("eventConcernsEsign", () => {
  it("esign.updated của đúng HĐ ⇒ tải lại thẻ", () => {
    expect(
      eventConcernsEsign(ev("esign.updated", { contract_id: CID, status: "completed" }), CID),
    ).toBe(true);
  });
  it("HĐ khác hoặc sự kiện khác ⇒ bỏ qua", () => {
    const other = "1f3c2a10-8b1e-4c55-9d7a-1a2b3c4d5e6f";
    expect(
      eventConcernsEsign(ev("esign.updated", { contract_id: other, status: "sent" }), CID),
    ).toBe(false);
    expect(
      eventConcernsEsign(
        ev("process.updated", { process_run_id: CID, status: "running", stage_idx: 0 }),
        CID,
      ),
    ).toBe(false);
  });
  it("khoá thừa / JSON hỏng ⇒ không thành sự kiện (parse trả null)", () => {
    expect(
      parseMeStreamProcessEvent(
        "esign.updated",
        JSON.stringify({ contract_id: CID, status: "x", extra: 1 }),
      ),
    ).toBeNull();
    expect(parseMeStreamProcessEvent("esign.updated", "{hỏng")).toBeNull();
  });
});

describe("ESIGN_QUERY_OPTS", () => {
  it("staleTime 0 + tải lại khi quay lại cửa sổ (mặc định 30 s của app sẽ chặn focus-refetch)", () => {
    expect(ESIGN_QUERY_OPTS.staleTime).toBe(0);
    expect(ESIGN_QUERY_OPTS.refetchOnWindowFocus).toBe(true);
  });
});
