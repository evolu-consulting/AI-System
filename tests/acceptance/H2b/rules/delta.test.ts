// WRK-FR-03 · HUB-FR-91 · H2b-R19, R22, R23 · streamAccept, nextSeqOk, reconcileStream (test-plan H2b §4 R25–R29,
// cases §1.6; chữ ký plan-rules, bảng plan §5.5).
import { describe, expect, it } from "bun:test";
import {
  nextSeqOk,
  reconcileStream,
  streamAccept,
} from "../../../../apps/hub-api/src/modules/stream/delta.rules";

describe("WRK-FR-03 · delta phía Hub [R25–R29]", () => {
  it("WRK-FR-03 · R25 · streamAccept theo vai / loại run / delegate đầu [H2b-R19]", () => {
    for (const firstDelegate of [true, false]) {
      const orch = streamAccept({ role: "orchestrator", runKind: "orchestrated", firstDelegate });
      expect(orch).toEqual(["answer"]);
      const direct = streamAccept({ role: "agent", runKind: "direct", firstDelegate });
      expect(direct).toEqual(["done", "partial"]);
      expect(streamAccept({ role: "agent", runKind: "command", firstDelegate })).toEqual([]);
    }
    const first = streamAccept({ role: "agent", runKind: "orchestrated", firstDelegate: true });
    expect(first).toEqual(["done"]);
    const later = streamAccept({ role: "agent", runKind: "orchestrated", firstDelegate: false });
    expect(later).toEqual([]);
  });

  it("WRK-FR-03 · R26 · nextSeqOk: đầu = 1, sau = trước + 1 [H2b-R22]", () => {
    expect(nextSeqOk(null, 1)).toBe(true);
    expect(nextSeqOk(null, 2)).toBe(false);
    expect(nextSeqOk(3, 4)).toBe(true);
    expect(nextSeqOk(3, 5)).toBe(false);
    expect(nextSeqOk(3, 3)).toBe(false);
  });

  it("WRK-FR-03 · R27 · reconcileStream: tiền tố → phần còn lại; lệch → S + delta_mismatch; F hỏng → stream_unparsed [H2b-R23]", () => {
    expect(reconcileStream("Xin", "Xin chào")).toEqual({
      rest: " chào",
      content: "Xin chào",
      trace: null,
    });
    expect(reconcileStream("Xin", "Xin")).toEqual({ rest: "", content: "Xin", trace: null });
    expect(reconcileStream("Xin", "Chào")).toEqual({
      rest: "",
      content: "Xin",
      trace: "delta_mismatch",
    });
    expect(reconcileStream("Xin", null)).toEqual({
      rest: "",
      content: "Xin",
      trace: "stream_unparsed",
    });
  });

  it("WRK-FR-03 · R28 · S rỗng → toàn bộ F [H2b-R23]", () => {
    expect(reconcileStream("", "abc")).toEqual({ rest: "abc", content: "abc", trace: null });
    expect(reconcileStream("", "")).toEqual({ rest: "", content: "", trace: null });
  });

  it("WRK-FR-03 · R29 · tiền tố theo đơn vị UTF-16: S dừng giữa cặp surrogate không phải lệch [H2b-R23]", () => {
    expect(reconcileStream("a\uD83D", "a😀")).toEqual({
      rest: "\uDE00",
      content: "a😀",
      trace: null,
    });
  });
});
