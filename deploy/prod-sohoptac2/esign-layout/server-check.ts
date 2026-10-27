// Kiểm bố cục trang ký DocuSign (chạy trong hub-api, dùng env DOCUSIGN_*): tạo phong bì NHÁP (status "created" ⇒ không gửi email)
// từ HTML trong /tmp/sign.html + tab theo anchor (offset trong /tmp/offset.json), lấy ảnh trang 1 (72 dpi) + toạ độ tab đã giải anchor,
// in JSON một dòng "LAYOUT {...}", rồi chuyển nháp vào thùng rác. Không in token/khoá.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const e = process.env;
const host = e.DOCUSIGN_OAUTH_HOST ?? "account-d.docusign.com";
const base = (e.DOCUSIGN_BASE_URI ?? "https://demo.docusign.net/restapi").replace(/\/+$/, "");
const acct = e.DOCUSIGN_ACCOUNT_ID as string;
const b64u = (b: string) => Buffer.from(b).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const body = b64u(
  JSON.stringify({
    iss: e.DOCUSIGN_INTEGRATION_KEY,
    sub: e.DOCUSIGN_USER_ID,
    aud: host,
    iat: now,
    exp: now + 600,
    scope: "signature impersonation",
  }),
);
const sig = createSign("RSA-SHA256")
  .update(`${head}.${body}`)
  .sign(readFileSync(e.DOCUSIGN_PRIVATE_KEY_FILE as string, "utf8"))
  .toString("base64url");
const tok = (await (
  await fetch(`https://${host}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${head}.${body}.${sig}`,
    }),
  })
).json()) as { access_token: string };
const H = { authorization: `Bearer ${tok.access_token}`, "content-type": "application/json" };
const A = `${base}/v2.1/accounts/${acct}`;

const html = readFileSync("/tmp/sign.html", "utf8");
// esign-anchor: offset.json có `mode` ("page" = trang ký cuối, anchor ẩn; "text" = HĐ mẫu, anchor = cụm trong văn bản `anchors[i]`,
// nguyên từ, không phân biệt hoa thường — như `docusign.provider.ts`).
const off = JSON.parse(readFileSync("/tmp/offset.json", "utf8")) as Record<
  "sign" | "date",
  { x: string; y: string }
> & { mode?: "page" | "text"; anchors?: string[] };
const text = off.mode === "text" && Array.isArray(off.anchors);
const tab = (s: string, o: { x: string; y: string }) => ({
  anchorString: s,
  anchorUnits: "pixels",
  anchorXOffset: o.x,
  anchorYOffset: o.y,
  anchorIgnoreIfNotPresent: "false",
  ...(text ? { anchorMatchWholeWord: "true", anchorCaseSensitive: "false" } : {}),
});
const signers = [0, 1].map((i) => ({
  recipientId: String(i + 1),
  routingOrder: String(i + 1),
  name: `Kiểm bố cục ${i + 1}`,
  email: `layout-check-${i + 1}@example.invalid`,
  tabs: {
    signHereTabs: [tab(text ? (off.anchors?.[i] as string) : `\\s${i + 1}\\`, off.sign)],
    dateSignedTabs: [tab(text ? (off.anchors?.[i] as string) : `\\d${i + 1}\\`, off.date)],
  },
}));
const cr = await fetch(`${A}/envelopes`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    emailSubject: "Kiem bo cuc trang ky (nhap)",
    status: "created",
    documents: [
      {
        documentId: "1",
        name: "trang-ky.html",
        fileExtension: "html",
        documentBase64: Buffer.from(html).toString("base64"),
      },
    ],
    recipients: { signers },
  }),
});
const env = (await cr.json()) as { envelopeId?: string; message?: string; errorCode?: string };
if (!env.envelopeId) {
  console.log(`LAYOUT_ERR http ${cr.status} ${env.errorCode ?? ""} ${env.message ?? ""}`);
  process.exit(1);
}
const id = env.envelopeId;
const tabs: { recipient: string; sign: unknown; date: unknown }[] = [];
for (const s of signers) {
  const t = (await (
    await fetch(`${A}/envelopes/${id}/recipients/${s.recipientId}/tabs`, { headers: H })
  ).json()) as Record<string, unknown>;
  tabs.push({ recipient: s.recipientId, sign: t.signHereTabs, date: t.dateSignedTabs });
}
// Ảnh của trang có ô ký đầu tiên (chế độ text: khối chữ ký có thể không ở trang 1).
const first = (tabs[0]?.sign as { pageNumber?: string }[] | undefined)?.[0];
const page = first?.pageNumber ?? "1";
const img = Buffer.from(
  await (
    await fetch(`${A}/envelopes/${id}/documents/1/pages/${page}/page_image?dpi=72`, { headers: H })
  ).arrayBuffer(),
);
await fetch(`${A}/folders/recyclebin`, {
  method: "PUT",
  headers: H,
  body: JSON.stringify({ envelopeIds: [id] }),
});
console.log(
  `LAYOUT ${JSON.stringify({ envelopeId: id, mode: off.mode ?? "page", page, tabs, png: img.toString("base64") })}`,
);
