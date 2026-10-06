// X1-AC09 · HUB-FR-10/44/91 · chat-web (dev/preview) phải proxy `/commands`, `/agents`, `/attachments/*` sang Hub
// (không rơi vào SPA fallback `text/html`). Không `page.route`: gọi thẳng origin chat-web bằng `request`.
import { expect, test } from "@playwright/test";
import { apiToken, resetMock } from "./_support";

test.beforeEach(async () => {
  await resetMock();
});

const PATHS = ["/commands", "/agents", "/attachments/x/content"];

for (const p of PATHS) {
  test(`X1-AC09 · GET ${p} qua chat-web không phải HTML của SPA (có Bearer)`, async ({
    request,
  }) => {
    const res = await request.get(p, { headers: { authorization: `Bearer ${await apiToken()}` } });
    expect(res.headers()["content-type"] ?? "").not.toContain("text/html");
    expect((await res.text()).trimStart().toLowerCase().startsWith("<!doctype")).toBe(false);
  });

  test(`X1-AC09 · GET ${p} qua chat-web thiếu Bearer ⇒ không phải HTML của SPA`, async ({
    request,
  }) => {
    const res = await request.get(p);
    expect(res.headers()["content-type"] ?? "").not.toContain("text/html");
    expect(res.status()).not.toBe(200);
  });
}
