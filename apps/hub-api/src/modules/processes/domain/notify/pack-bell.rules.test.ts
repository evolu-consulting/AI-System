import { describe, expect, it } from "bun:test";
import { packBellTitle } from "./pack-bell.rules";

// CR-125 · UX M2: tiêu đề chuông/thư "Cần duyệt" nói được HỢP ĐỒNG NÀO khi run gắn bản ghi có nhãn.
describe("packBellTitle · nhãn bản ghi", () => {
  it("có record_label ⇒ Cần duyệt: <nhãn> · <bước>", () => {
    expect(
      packBellTitle("review_requested", {
        stage_name: "Giám đốc duyệt",
        record_label: "HĐ 12/2026 · Mua văn phòng phẩm",
      }),
    ).toBe("Cần duyệt: HĐ 12/2026 · Mua văn phòng phẩm · Giám đốc duyệt");
  });
  it("không có nhãn ⇒ giữ nguyên Cần duyệt: <bước>; run_finished không chèn nhãn", () => {
    expect(packBellTitle("review_requested", { stage_name: "Giám đốc duyệt" })).toBe(
      "Cần duyệt: Giám đốc duyệt",
    );
    expect(
      packBellTitle("run_finished", { process_name: "Duyệt 2 cấp", record_label: "HĐ 1" }),
    ).toBe("Kết thúc duyệt: Duyệt 2 cấp");
  });
});
