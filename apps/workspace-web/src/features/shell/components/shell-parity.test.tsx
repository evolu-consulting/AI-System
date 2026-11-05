// CR-121 C-6 · cỡ/nét biểu tượng menu do Sidebar ép (không phụ thuộc icon module truyền vào) + nút trợ lý dùng chung.
import { describe, expect, test } from "bun:test";
import { Newspaper } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantFab } from "~/shared/ui/AssistantFab";
import { NavIcon } from "./Sidebar";

describe("CR-121 C-6 · khung dùng chung", () => {
  test("NavIcon ép 20 px, nét 1.8 dù icon (lucide) mặc định 24 px / 2", () => {
    const html = renderToStaticMarkup(<NavIcon icon={Newspaper} />);
    expect(html).toContain('width="20"');
    expect(html).toContain('height="20"');
    expect(html).toContain('stroke-width="1.8"');
  });
  test("AssistantFab: nút tròn cùng testid, tooltip 'Hỏi trợ lý AI'", () => {
    const html = renderToStaticMarkup(
      <AssistantFab icon={<i />} label="Mở" tooltip="Hỏi trợ lý AI" onClick={() => {}} />,
    );
    expect(html).toContain('data-testid="assistant-fab"');
    expect(html).toContain("rounded-full");
    expect(html).toContain("Hỏi trợ lý AI");
  });
});
