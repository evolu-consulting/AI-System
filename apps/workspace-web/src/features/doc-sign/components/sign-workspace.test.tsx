// CR-181 · s11b · màn ký: thả từ khay, giáp lai, Delete, ô người khác, chữ ký số khoá, hỏi khi rời.
import { beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { rectFromParts, type StagePage } from "../lib/geometry";
import { boxKeyAction, closeAction } from "../lib/keys";
import { layoutPages } from "../lib/layout";
import { moveItem, type NewItem, placeItem, removeItem } from "../lib/sign-items";
import { FieldBox } from "./FieldBox";
import { SignTopBar } from "./SignTopBar";
import { SignWorkspace } from "./SignWorkspace";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const { pages } = layoutPages(
  [
    { ptWidth: 600, ptHeight: 800 },
    { ptWidth: 600, ptHeight: 800 },
  ],
  900,
);
const spec: NewItem = { kind: "mark", aspect: 2.4, status: "editable" };
const noop = () => undefined;
const boxProps = {
  rect: { l: 10, t: 10, w: 100, h: 40 },
  selected: false,
  stage: { width: 900, height: 2000 },
  seams: [],
  onSelect: noop,
  onDeselect: noop,
  onSeam: noop,
  onCommit: noop,
  onDelete: noop,
};
const page0 = pages[0] as StagePage;
const page1 = pages[1] as StagePage;

describe("thả / kéo / xoá", () => {
  test("thả từ khay vào một trang ⇒ item có 1 phần ở trang đó", () => {
    const r = { l: page0.left + 20, t: page0.top + 20, w: 120, h: 50 };
    const items = placeItem([], spec, r, pages);
    expect(items?.[0]?.parts).toHaveLength(1);
    expect(items?.[0]?.parts[0]?.page).toBe(0);
  });
  test("kéo qua khe giữa hai trang ⇒ 2 phần; kéo lại vào một trang ⇒ 1 phần", () => {
    const r = { l: page0.left + 20, t: page1.top - 30, w: 120, h: 50 };
    const items = placeItem([], spec, r, pages) ?? [];
    expect(items[0]?.parts.map((x) => x.page)).toEqual([0, 1]);
    const moved = moveItem(items, items[0]?.id ?? "", { ...r, t: page0.top + 10 }, pages);
    expect(moved[0]?.parts).toHaveLength(1);
    const back = rectFromParts(moved[0]?.parts ?? [], pages);
    expect(Math.round(back?.t ?? 0)).toBe(Math.round(page0.top + 10));
  });
  test("Delete ⇒ hành động xoá; xoá bỏ item sửa được, giữ item của người khác", () => {
    expect(boxKeyAction("Delete", true)).toEqual({ type: "delete" });
    expect(boxKeyAction("ArrowLeft", true)).toEqual({ type: "nudge", key: "ArrowLeft" });
    expect(boxKeyAction("Delete", false)).toBeNull();
    const a = placeItem([], spec, { l: page0.left, t: page0.top, w: 100, h: 40 }, pages) ?? [];
    const first = a[0];
    if (!first) throw new Error("no item");
    const both = [...a, { ...first, id: "x", status: "other" as const }];
    const left = removeItem(both, first.id);
    expect(left.map((i) => i.id)).toEqual(["x"]);
    expect(removeItem(left, "x")).toHaveLength(1);
  });
  test("dirty ⇒ hỏi khi đóng; sạch ⇒ đóng luôn", () => {
    expect(closeAction(true)).toBe("confirm");
    expect(closeAction(false)).toBe("close");
  });
});

describe("hiển thị", () => {
  const field = {
    id: "f",
    kind: "field" as const,
    parts: [],
    aspect: 2.4,
    side: "B" as const,
    person: "Bình",
  };
  test("ô người khác: «Chờ Bình ký», không có nút bấm", () => {
    const out = html(<FieldBox {...boxProps} item={{ ...field, status: "other" }} mode="sign" />);
    expect(out).toContain("Chờ Bình ký");
    expect(out).not.toContain("<button");
  });
  test("ô của mình: nút «Bấm để ký»", () => {
    const out = html(<FieldBox {...boxProps} item={{ ...field, status: "mine" }} mode="sign" />);
    expect(out).toContain("<button");
    expect(out).toContain("Bấm để ký");
  });
  test("«Chữ ký số» khoá kèm lý do", () => {
    const out = html(
      <SignTopBar
        trays={[]}
        kinds={[
          { kind: "internal" },
          { kind: "digital", disabledReason: "Công ty chưa bật chữ ký số" },
        ]}
        kind="internal"
        onKind={noop}
        saveLabel="Lưu"
        onSave={noop}
        onClose={noop}
      />,
    );
    expect(out).toContain("Chữ ký số");
    expect(out).toContain("Công ty chưa bật chữ ký số");
    expect(out.match(/aria-disabled="true"/g)).toHaveLength(1);
  });
  test("khung màn ký: thanh trên + đang tải tệp", () => {
    const out = html(
      <SignWorkspace
        files={[{ id: "a", name: "hd.pdf", pageCount: 2, load: async () => new ArrayBuffer(0) }]}
        mode="sign"
        items={{}}
        trays={[]}
        signatureKinds={[{ kind: "internal" }]}
        kind="internal"
        onKindChange={noop}
        onChange={noop}
        onSave={noop}
        onClose={noop}
        saveLabel="Lưu"
        dirty={false}
      />,
    );
    expect(out).toContain('data-testid="sign-workspace"');
    expect(out).toContain("Đang tải tệp");
  });
});
