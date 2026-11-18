// CR-184 · «Quy trình: [Tên ▾]» là Select của kit (không còn danh sách thẻ): nhãn, giá trị đang chọn, vùng bấm 44px trên điện thoại.
import { beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { type CurrentFlow, toCurrentFlows } from "../lib/current-flow";
import { FlowPicker } from "./FlowPicker";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const flows = toCurrentFlows({
  items: [
    { def_id: A, name: "Duyệt 2 cấp", rel_version: 1, steps: [], start_when: null },
    { def_id: B, name: "Hợp đồng lớn", rel_version: 3, steps: [], start_when: null },
  ],
}) as CurrentFlow[];

describe("FlowPicker", () => {
  const render = () =>
    renderToStaticMarkup(<FlowPicker flows={flows} value={B} onChange={() => {}} />);
  test("có nhãn «Quy trình» gắn với ô chọn, hiện tên quy trình đang chọn", () => {
    const out = render();
    expect(out).toContain(">Quy trình<");
    expect(out).toContain('for="flow-select"');
    expect(out).toContain('id="flow-select"');
    expect(out).toContain('role="combobox"');
    expect(out).toContain("Hợp đồng lớn");
  });
  test("là Select của kit: vùng bấm ≥ 44px trên điện thoại, không còn danh sách thẻ", () => {
    const out = render();
    expect(out).toContain("max-sm:min-h-11");
    expect(out).not.toContain("flow-item-");
    expect(out).not.toContain("<ol");
  });
});
