import { describe, expect, test } from "bun:test";
import { findGapViolations, spacedClasses } from "./check-button-gap.rules";

describe("check-button-gap", () => {
  test("đỏ: hai nút trong flex không gap", () => {
    const s = `export const A = () => (\n  <div className="flex justify-end">\n    <Button>Hủy</Button>\n    <Button type="submit">Lưu</Button>\n  </div>\n);`;
    expect(findGapViolations(s)).toEqual([{ line: 2, tag: "div" }]);
  });
  test("đỏ: nút nằm trong fragment điều kiện", () => {
    const s = `const A = () => (<div className={cn("flex items-center", x)}>{ok && (<><Button>a</Button><button>b</button></>)}</div>);`;
    expect(findGapViolations(s)).toHaveLength(1);
  });
  test("xanh: có gap-2", () => {
    const s = `const A = () => (<div className="flex gap-2"><Button>a</Button><Button>b</Button></div>);`;
    expect(findGapViolations(s)).toEqual([]);
  });
  test("xanh: flex-col, một nút, nút có margin", () => {
    expect(
      findGapViolations(
        `const A = () => (<div className="flex flex-col"><Button/><Button/></div>);`,
      ),
    ).toEqual([]);
    expect(
      findGapViolations(`const A = () => (<div className="flex"><Button/><span/></div>);`),
    ).toEqual([]);
    expect(
      findGapViolations(
        `const A = () => (<div className="flex"><Button/><Button className="ml-2"/></div>);`,
      ),
    ).toEqual([]);
  });
  test("xanh: chú thích button-gap-ok", () => {
    const s = `const A = () => (\n  // button-gap-ok\n  <div className="flex"><Button/><Button/></div>\n);`;
    expect(findGapViolations(s)).toEqual([]);
  });
  test("không nhầm generic và so sánh", () => {
    const s = `const x = useState<Foo>(1); const y = a < b; const A = () => <div className="flex gap-1"><Button/><Button/></div>;`;
    expect(findGapViolations(s)).toEqual([]);
  });
  test("đỏ/xanh: class thường theo CSS gap", () => {
    const s = `const A = () => (<div className="xf"><button/><button/></div>);`;
    expect(findGapViolations(s, spacedClasses(".ghost { gap: 6px; }"))).toHaveLength(1);
    expect(findGapViolations(s, spacedClasses(".xf { display: flex; gap: 8px; }"))).toEqual([]);
  });
});
