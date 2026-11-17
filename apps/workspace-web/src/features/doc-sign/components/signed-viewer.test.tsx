// CR-181 · s14 · «Xem bản đã ký»: mặc định bản mới nhất, nhãn bản, danh sách chữ ký đúng bản, giáp lai, Tải về, không nút sửa.
import { beforeAll, describe, expect, test } from "bun:test";
import type {
  SignPart,
  SignVersionItemOut,
  SignVersionMarkOut,
} from "@ai/contracts/pack-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import {
  contentPath,
  dotsOf,
  jumpTarget,
  latestVersion,
  pickVersion,
  versionKey,
  versionLabel,
} from "../lib/viewer-model";
import { ViewerPanel } from "./ViewerPanel";
import { ViewerTopBar } from "./ViewerTopBar";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
const part = (page: number): SignPart => ({
  page,
  x: 10,
  y: 10,
  w: 100,
  h: 40,
  cx: 10,
  cy: 10,
  cw: 100,
  ch: 40,
});
const mark = (
  name: string,
  placement: SignVersionMarkOut["placement"],
  pages: number[],
): SignVersionMarkOut => ({
  signer_id: name,
  signer_name: name,
  field_id: null,
  placement,
  pages,
  parts: pages.map(part),
  caption: null,
});
const ver = (seq: number, o: Partial<SignVersionItemOut> = {}): SignVersionItemOut => ({
  version_id: seq === 0 ? null : `v${seq}`,
  seq,
  original: seq === 0,
  signed_by: seq === 0 ? null : `u${seq}`,
  signed_by_name: seq === 0 ? null : `Người ${seq}`,
  signed_at: seq === 0 ? null : "2026-11-17T03:00:00Z",
  kind: seq === 0 ? null : "internal",
  voided: false,
  sha256: null,
  url:
    seq === 0
      ? "/contracts/c1/sign-docs/f1/content"
      : `/contracts/c1/sign-docs/f1/versions/v${seq}/content`,
  marks: seq === 0 ? [] : [mark(`Người ${seq}`, "field", [0])],
  ...o,
});
const vs = [
  ver(0),
  ver(1),
  ver(2, { marks: [mark("Người 1", "field", [0]), mark("Người 2", "seam", [1, 2])] }),
];
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const noop = () => undefined;

describe("chọn bản", () => {
  test("mặc định bản mới nhất, v không có thật ⇒ cũng bản mới nhất, v có thật ⇒ bản đó", () => {
    expect(pickVersion(vs, undefined)?.seq).toBe(2);
    expect(pickVersion(vs, "nope")?.seq).toBe(2);
    expect(pickVersion(vs, "v1")?.seq).toBe(1);
  });
  test("chọn «Bản gốc»: khoá bản gốc là «original», chọn ra đúng bản gốc (không rơi về bản mới nhất)", () => {
    const orig = vs[0] as SignVersionItemOut;
    expect(versionKey(orig)).toBe("original");
    expect(pickVersion(vs, versionKey(orig))).toBe(orig);
    expect(pickVersion(vs, versionKey(orig))?.marks).toHaveLength(0);
  });
  test("bản bị bỏ (Trả lại) không là mặc định", () => {
    expect(latestVersion([ver(0), ver(1), ver(2, { voided: true })])?.seq).toBe(1);
  });
  test("nhãn bản: gốc / sau khi <người> ký · <giờ>", () => {
    expect(versionLabel(vs[0] as SignVersionItemOut, "?", "")).toEqual({
      key: "contracts.docsign.viewer.original",
    });
    expect(i18n.t("contracts.docsign.viewer.original")).toBe("Bản gốc");
    const l = versionLabel(vs[1] as SignVersionItemOut, "?", "10:00");
    expect(l).toEqual({ key: "contracts.docsign.viewer.afterSign", who: "Người 1", at: "10:00" });
    expect(i18n.t(l.key, { who: "Người 1", at: "10:00" })).toBe("Sau khi Người 1 ký · 10:00");
    expect(i18n.t("contracts.docsign.viewer.voided")).toBe("(đã bỏ)");
  });
});

describe("khung phải", () => {
  test("liệt kê đúng chữ ký của bản đang chọn, kèm kiểu và loại nội bộ", () => {
    const v2 = vs[2] as SignVersionItemOut;
    const h = html(
      <ViewerPanel marks={v2.marks} kind="internal" pending={[]} atOf={() => "g"} onJump={noop} />,
    );
    expect(h.match(/data-testid="viewer-mark"/g)).toHaveLength(2);
    expect(h).toContain("Ô chỗ ký");
    expect(h).toContain("Giáp lai");
    expect(h).toContain("chữ ký nội bộ");
    const v1 = vs[1] as SignVersionItemOut;
    const h1 = html(
      <ViewerPanel marks={v1.marks} kind="internal" pending={[]} atOf={() => "g"} onJump={noop} />,
    );
    expect(h1.match(/data-testid="viewer-mark"/g)).toHaveLength(1);
  });
  test("nhãn bốn kiểu", () => {
    for (const [k, vi] of [
      ["field", "Ô chỗ ký"],
      ["seam", "Giáp lai"],
      ["initials", "Ký nháy"],
    ] as const)
      expect(i18n.t(`contracts.docsign.viewer.placement.${k}`)).toBe(vi);
    expect(i18n.t("contracts.docsign.viewer.placement.free")).toBe("Tự đặt");
  });
  test("giáp lai: bấm ⇒ nhảy tới trang đầu và viền mọi trang của chữ ký", () => {
    const j = jumpTarget((vs[2] as SignVersionItemOut).marks[1]?.parts ?? []);
    expect(j?.page).toBe(1);
    expect(j?.flash).toEqual([1, 2]);
    expect(j?.parts).toHaveLength(2);
    expect(jumpTarget([])).toBeNull();
  });
  test("chấm cột trang theo bên của ô, không thuộc ô ⇒ mark", () => {
    const v = ver(1, {
      marks: [{ ...mark("a", "field", [0]), field_id: "f" }, mark("b", "free", [0, 1])],
    });
    expect(dotsOf(v, { f: "A" })).toEqual({ 0: ["A", "mark"], 1: ["mark"] });
  });
});

describe("thanh trên", () => {
  const bar = (current: SignVersionItemOut) =>
    html(
      <ViewerTopBar
        versions={vs}
        current={current}
        labelOf={(v) => `b${v.seq}`}
        onVersion={noop}
        onBack={noop}
        onDownload={noop}
      />,
    );
  test("Tải về trỏ đúng URL của bản đang xem", () => {
    expect(bar(vs[1] as SignVersionItemOut)).toContain(
      `data-href="${contentPath(vs[1] as SignVersionItemOut)}"`,
    );
    expect(contentPath(vs[2] as SignVersionItemOut)).toBe(
      "/pack/contracts/contracts/c1/sign-docs/f1/versions/v2/content",
    );
  });
  test("chỉ xem: có Quay lại và Tải về, không nút Lưu/Xoá/Ký, không chữ «Phiên bản»", () => {
    const h = bar(vs[2] as SignVersionItemOut);
    expect(h).toContain("Quay lại");
    expect(h).toContain("Tải về");
    expect(h).toContain("Xem bản đã ký");
    for (const w of ["Lưu", "Xoá", "Bấm để ký", "Phiên bản", "contenteditable"])
      expect(h).not.toContain(w);
    const panel = html(
      <ViewerPanel marks={[]} kind={null} pending={[]} atOf={() => ""} onJump={noop} />,
    );
    expect(panel).not.toContain("Phiên bản");
    expect(panel.match(/<button/g)).toBeNull();
  });
});
