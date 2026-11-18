// CR-184: dải người ký = avatar viền theo bên, dấu ✓ khi đã ký, tooltip «<tên> · Bên · trạng thái», nhóm = một avatar mỗi thành viên.
import { beforeAll, describe, expect, test } from "bun:test";
import type { SignSessionOut } from "@ai/contracts/pack-contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { SignersStrip } from "./SignersStrip";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
  await i18n.reloadResources("vi");
});

const fld = (side: "A" | "B", ref: string, signed: boolean) => ({
  id: `${side}${ref}`,
  side,
  signer_kind: "user",
  signer_ref: ref,
  signed,
});
const session = {
  files: [{ needs_sign: true, fields: [fld("A", "u1", true), fld("B", "u2", false)] }],
  signers: [
    { side: "A", kind: "user", ref: "u1", name: "Lê Minh Cường", mine: true },
    { side: "B", kind: "partner", ref: "u2", name: "Trần Đối Tác", mine: false },
    {
      side: "A",
      kind: "group",
      ref: "g1",
      name: "Đại diện Pháp chế",
      mine: false,
      members: [
        { id: "m1", name: "An Nguyễn" },
        { id: "m2", name: "Bình Trần" },
      ],
    },
  ],
} as unknown as SignSessionOut;

const html = () =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <SignersStrip session={session} />
    </QueryClientProvider>,
  );

describe("SignersStrip", () => {
  test("viền tím Bên A / cam Bên B, tooltip có tên · bên · trạng thái", () => {
    const out = html();
    expect(out).toContain("ring-act");
    expect(out).toContain("ring-late");
    expect(out).toContain("Lê Minh Cường · Bên A · Đã ký");
    expect(out).toContain("Trần Đối Tác · Bên B · Chưa có chỗ ký");
  });
  test("đã ký có dấu ✓, chưa ký không có", () => {
    const out = html();
    expect(out.match(/data-testid="signed-mark"/g)?.length).toBe(1);
  });
  test("nhóm: một avatar mỗi thành viên, mỗi tooltip đúng tên người đó", () => {
    const out = html();
    expect(out).toContain('aria-label="An Nguyễn"');
    expect(out).toContain('aria-label="Bình Trần"');
    expect(out).toContain("An Nguyễn · Bên A");
    expect(out).toContain("Bình Trần · Bên A");
    expect(out).not.toContain("An Nguyễn, Bình Trần");
  });
});
