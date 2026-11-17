// CR-181 · s13 · bảng Tài liệu kèm khi bật ký; Đạt khoá; ô vẽ tay ẩn khi bật.
import { beforeAll, describe, expect, test } from "bun:test";
import type { SignFileOut, SignSessionOut } from "@ai/contracts/pack-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { docSignRule, evidenceIssue, evidenceRuleOf } from "~/platform/flow";
import { EvidenceAsk } from "~/platform/flow/ui/EvidenceAsk";
import { SignFilesList } from "./SignFilesList";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
const f = (o: Partial<SignFileOut>): SignFileOut =>
  ({
    file_id: "p1",
    name: "a.pdf",
    is_main: false,
    is_pdf: true,
    uploader_id: "u1",
    can_prep: true,
    pages: 3,
    needs_sign: true,
    latest: { version_id: null, seq: 0, url: "" },
    fields: [],
    ...o,
  }) as SignFileOut;
const s = (files: SignFileOut[], locked = false) =>
  ({ enabled: true, mode: "prep", locked, files, signers: [] }) as unknown as SignSessionOut;
const list = (session: SignSessionOut) =>
  renderToStaticMarkup(
    <SignFilesList
      id="c1"
      session={session}
      own={[]}
      busy={false}
      onToggle={() => undefined}
      onRemove={() => undefined}
    />,
  );

describe("SignFilesList", () => {
  test("tệp chính là dòng đầu, nhãn «Hợp đồng chính»", () => {
    const h = list(
      s([f({ file_id: "x", name: "kem.pdf" }), f({ file_id: "m", name: "hd.pdf", is_main: true })]),
    );
    expect(h.indexOf("hd.pdf")).toBeLessThan(h.indexOf("kem.pdf"));
    expect(h).toContain("Hợp đồng chính");
  });
  test("công tắc khoá với người không tải lên, chỗ ký «Chưa đặt»", () => {
    const h = list(s([f({ can_prep: false })]));
    expect(h).toMatch(
      /<button[^>]*data-testid="needs-sign"[^>]*disabled|<button[^>]*disabled[^>]*data-testid="needs-sign"/,
    );
    expect(h).toContain("Chưa đặt");
  });
  test("tệp đã ký ⇒ «Xem bản đã ký» trỏ /contracts/signed/…?file=", () => {
    const fld = {
      id: "1",
      side: "A",
      signer_kind: "user",
      signer_ref: "u",
      label: "",
      parts: {},
      mine: false,
      signed: true,
      signed_by: "u",
      signed_version_id: "v",
    };
    const h = list(
      s([f({ fields: [fld] as never, latest: { version_id: "v", seq: 1, url: "" } })]),
    );
    expect(h).toContain("/contracts/signed/c1?file=p1");
    expect(h).toContain("Đã ký đủ");
  });
});

describe("thẻ duyệt khi bật ký", () => {
  const base = evidenceRuleOf(undefined, "opinion_plus", "approve") as NonNullable<
    ReturnType<typeof evidenceRuleOf>
  >;
  test("ô vẽ tay ẩn, không cần chữ ký/tệp, chỉ cần ý kiến", () => {
    const r = docSignRule(base);
    expect(r.signature).toBe(false);
    expect(evidenceIssue({ note: "ok", signatureId: null, fileIds: [] }, r)).toBeNull();
    expect(evidenceIssue({ note: "ok", signatureId: null, fileIds: [] }, base)).toBe("proof");
  });
  const ask = (ready: boolean) =>
    renderToStaticMarkup(
      <EvidenceAsk
        action={{
          key: "approve",
          label: "Đạt",
          style: "primary",
          confirm: false,
          input: { kind: "none" },
        }}
        rule={docSignRule(base)}
        busy={false}
        onSend={() => undefined}
        onCancel={() => undefined}
        docSign={{ slot: <p>KHUNG-KY</p>, ready }}
      />,
    );
  const dis =
    /<button[^>]*data-testid="request-approve-confirm"[^>]*disabled|<button[^>]*disabled[^>]*data-testid="request-approve-confirm"/;
  test("Đạt khoá khi chưa ký đủ, mở khi đủ, không có ô vẽ tay", () => {
    const off = ask(false);
    expect(off).toContain("KHUNG-KY");
    expect(off).toMatch(dis);
    expect(ask(true)).not.toMatch(dis);
    expect(off).not.toContain("canvas");
  });
});
