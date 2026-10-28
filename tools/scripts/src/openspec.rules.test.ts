import { describe, expect, test } from "bun:test";
import { markMerged, parseDelta, validateDelta } from "./openspec.rules";

const has = (f: string) => f === "sht/chung-tu.md";
const check = (t: string) => validateDelta(parseDelta(t), has).map((i) => i.msg);

const GOOD = `# x
## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Mở lại chứng từ
Người phụ trách hoặc owner mở lại.
- Kịch bản: khi người phụ trách bấm Mở lại thì chứng từ về Nháp
### ADDED sht/moi.md
#### Yêu cầu: Gắn HĐ
- Kịch bản: khi chọn HĐ thì gắn được
### REMOVED sht/chung-tu.md
Lý do: bỏ nút tạo phụ lục
## Việc còn lại
`;

describe("parseDelta/validateDelta", () => {
  test("mẫu đúng không lỗi", () => {
    expect(check(GOOD)).toEqual([]);
    const p = parseDelta(GOOD);
    expect(p.state).toBe("chưa gộp");
    expect(p.blocks.map((b) => b.kind)).toEqual(["MODIFIED", "ADDED", "REMOVED"]);
  });

  test("một dòng miễn trừ hợp lệ", () => {
    const t =
      "## Delta (so với docs/current)\nTrạng thái gộp: chưa gộp\nKhông thay đổi hành vi (lý do: chỉ test)\n";
    expect(check(t)).toEqual([]);
  });

  test("miễn trừ thiếu lý do / lẫn với khối", () => {
    const a =
      "## Delta (so với docs/current)\nTrạng thái gộp: chưa gộp\nKhông thay đổi hành vi (lý do: )\n";
    expect(check(a).join()).toContain("thiếu lý do");
    const b = `${GOOD}\n`.replace(
      "Trạng thái gộp: chưa gộp",
      "Trạng thái gộp: chưa gộp\nKhông thay đổi hành vi (lý do: x)",
    );
    expect(check(b).join()).toContain("chọn một");
  });

  test("thiếu mục Delta", () => {
    expect(check("# x\n## Plan\n")[0]).toContain("thiếu mục");
  });

  test("Yêu cầu thiếu Kịch bản, có số dòng", () => {
    const t = GOOD.replace("- Kịch bản: khi chọn HĐ thì gắn được\n", "");
    const i = validateDelta(parseDelta(t), has);
    expect(i).toHaveLength(1);
    expect(i[0]?.msg).toContain('"Gắn HĐ"');
    expect(i[0]?.line).toBe(10);
  });

  test("MODIFIED/REMOVED tới file không có; ADDED được tạo", () => {
    const t = GOOD.replace("MODIFIED sht/chung-tu.md", "MODIFIED sht/khong-co.md");
    expect(check(t).join()).toContain("không tồn tại");
    expect(check(GOOD.replace("REMOVED sht/chung-tu.md", "REMOVED sht/nope.md")).join()).toContain(
      "không tồn tại",
    );
  });

  test("REMOVED thiếu lý do, thiếu trạng thái, khối sai loại, delta rỗng", () => {
    expect(check(GOOD.replace("Lý do: bỏ nút tạo phụ lục\n", "")).join()).toContain("Lý do");
    expect(check(GOOD.replace("Trạng thái gộp: chưa gộp\n", "")).join()).toContain(
      "Trạng thái gộp",
    );
    expect(check(GOOD.replace("### ADDED", "### THEM")).join()).toContain("không hợp lệ");
    expect(check("## Delta (so với docs/current)\nTrạng thái gộp: chưa gộp\n").join()).toContain(
      "rỗng",
    );
  });

  test("trạng thái đã gộp + định dạng sai", () => {
    expect(parseDelta(GOOD.replace("chưa gộp", "đã gộp 2026-10-28 (đợt X)")).state).toBe("đã gộp");
    expect(check(GOOD.replace("chưa gộp", "xong")).join()).toContain("không hợp lệ");
  });

  test("bỏ qua khối code và đường dẫn thoát", () => {
    const t =
      "## Delta (so với docs/current)\nTrạng thái gộp: chưa gộp\n```\n### BAD x\n```\nKhông thay đổi hành vi (lý do: x)\n";
    expect(check(t)).toEqual([]);
    expect(check(GOOD.replace("sht/moi.md", "../moi.md")).join()).toContain("đường dẫn");
  });

  test("markMerged", () => {
    const p = parseDelta(GOOD);
    const out = markMerged(GOOD, p, "2026-10-28", "A") ?? "";
    expect(out).toContain("Trạng thái gộp: đã gộp 2026-10-28 (đợt A)");
    expect(check(out)).toEqual([]);
  });
});
