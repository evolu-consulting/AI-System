// esign-anchor · adapter DocuSign THẬT ↔ server DocuSign GIẢ cục bộ (Bun.serve): có cụm ⇒ tabs anchor theo cụm, chỉ tài liệu HĐ;
// không cụm ⇒ trang ký cuối (anchor ẩn); DocuSign báo không thấy cụm ⇒ gửi lại MỘT lần bằng trang ký cuối + log không PII.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { TEXT_TAB_OFFSET } from "../domain/esign.anchor";
import { docusignProvider } from "./docusign.provider";

type Tab = Record<string, string>;
type Body = {
  documents: { documentId: string; fileExtension: string }[];
  recipients: { signers: { tabs: { signHereTabs: Tab[]; dateSignedTabs: Tab[] } }[] };
};
const posts: Body[] = [];
let rejectAnchors = false;
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/oauth/token")
      return Response.json({ access_token: "tok", expires_in: 3600 });
    const b = (await req.json()) as Body;
    posts.push(b);
    const textMode = b.recipients.signers.some(
      (s) => s.tabs.signHereTabs[0]?.anchorMatchWholeWord === "true",
    );
    if (rejectAnchors && textMode)
      return Response.json(
        { errorCode: "ANCHOR_TAB_STRING_NOT_FOUND", message: "ĐẠI DIỆN BÊN A" },
        { status: 400 },
      );
    return Response.json({ envelopeId: `env-${posts.length}` }, { status: 201 });
  },
});
const kp = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const warns: { msg: string; f: Record<string, unknown> }[] = [];
const origin = `http://localhost:${server.port}`;
const p = docusignProvider(
  {
    integrationKey: "ik",
    userId: "u",
    accountId: "acc-1",
    baseUri: `${origin}/restapi`,
    oauthHost: origin,
    privateKeyFile: "(mem)",
    hmacKey: null,
  },
  { readKey: async () => kp.privateKey, log: { warn: (msg, f) => warns.push({ msg, f }) } },
);
const input = (anchors?: string[] | null) => ({
  subject: "Ky hop dong",
  title: "HĐ",
  number: null,
  document: { name: "hd.pdf", bytes: new Uint8Array([37, 80, 68, 70]) },
  signers: [
    { role: "company" as const, name: "Lan", email: "lan@a.vn", order: 1, clientUserId: "u1" },
    { role: "partner" as const, name: "B", email: "b@b.vn", order: 2, clientUserId: null },
  ],
  ...(anchors !== undefined ? { anchors } : {}),
});

beforeAll(() => {
  posts.length = 0;
});
afterAll(async () => {
  await server.stop(true);
});

describe("esign-anchor · DocuSign tabs", () => {
  it("có cụm ⇒ tabs anchorString = cụm, nguyên từ, không phân biệt hoa thường; KHÔNG nối trang ký", async () => {
    rejectAnchors = false;
    const r = await p.createEnvelope(input(["ĐẠI DIỆN BÊN A", "ĐẠI DIỆN BÊN B"]));
    expect(r.placement).toBe("text");
    const b = posts.at(-1) as Body;
    expect(b.documents.map((d) => d.documentId)).toEqual(["1"]);
    const [s1, s2] = b.recipients.signers;
    expect(s1?.tabs.signHereTabs[0]).toEqual({
      anchorString: "ĐẠI DIỆN BÊN A",
      anchorUnits: "pixels",
      anchorXOffset: TEXT_TAB_OFFSET.sign.x,
      anchorYOffset: TEXT_TAB_OFFSET.sign.y,
      anchorIgnoreIfNotPresent: "false",
      anchorMatchWholeWord: "true",
      anchorCaseSensitive: "false",
    });
    expect(s1?.tabs.dateSignedTabs[0]?.anchorYOffset).toBe(TEXT_TAB_OFFSET.date.y);
    expect(s2?.tabs.signHereTabs[0]?.anchorString).toBe("ĐẠI DIỆN BÊN B");
  });

  it("không cụm ⇒ trang ký cuối (HTML) + anchor ẩn \\s1\\ \\d1\\", async () => {
    const r = await p.createEnvelope(input(null));
    expect(r.placement).toBe("page");
    const b = posts.at(-1) as Body;
    expect(b.documents.map((d) => d.fileExtension)).toEqual(["pdf", "html"]);
    expect(b.recipients.signers[0]?.tabs.signHereTabs[0]?.anchorString).toBe("\\s1\\");
    expect(b.recipients.signers[1]?.tabs.dateSignedTabs[0]?.anchorString).toBe("\\d2\\");
    // số cụm khác số người ký ⇒ trang ký cuối
    expect((await p.createEnvelope(input(["ĐẠI DIỆN BÊN A"]))).placement).toBe("page");
  });

  it("DocuSign không thấy cụm ⇒ gửi lại một lần bằng trang ký cuối, log không PII", async () => {
    rejectAnchors = true;
    const n = posts.length;
    const r = await p.createEnvelope(input(["ĐẠI DIỆN BÊN A", "ĐẠI DIỆN BÊN B"]));
    expect(r).toEqual({ envelopeId: `env-${n + 2}`, placement: "page" });
    expect(posts.length).toBe(n + 2);
    expect((posts.at(-1) as Body).documents.length).toBe(2);
    expect(warns).toEqual([
      { msg: "esign-anchor-fallback", f: { detail: "api 400 ANCHOR_TAB_STRING_NOT_FOUND" } },
    ]);
    expect(JSON.stringify(warns)).not.toContain("lan@a.vn");
    rejectAnchors = false;
  });
});
