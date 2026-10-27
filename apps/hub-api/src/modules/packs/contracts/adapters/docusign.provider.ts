// cf-esign-docusign · adapter `ESignProvider` cho DocuSign eSignature REST v2.1. Auth: JWT Grant (RS256 tự ký, `docusign.crypto.ts`),
// token cache tới hết hạn (trừ 60 s), 401 ⇒ bỏ cache. Khoá PEM đọc lười một lần từ `DOCUSIGN_PRIVATE_KEY_FILE`. Không log token/khoá/
// thân; lỗi chỉ mang status + `errorCode` của DocuSign. `oauthHost`/`baseUri` có thể mang scheme (test: server giả http cục bộ).

import { logger } from "../../../../lib/logger";
import {
  type ESignEnvelopeInfo,
  type ESignProvider,
  ESignProviderError,
} from "../application/esign.ports";
import { TEXT_TAB_OFFSET } from "../domain/esign.anchor";
import type { ESignConfig } from "../domain/esign.rules";
import {
  envelopeIdOfWebhook,
  SIGN_TAB_OFFSET,
  signAnchors,
  signaturePageHtml,
} from "../domain/esign.rules";
import { connectHmacOk, docusignJwt } from "./docusign.crypto";

const TIMEOUT_MS = 15_000;
const SKEW_S = 60;

type Deps = {
  readKey?: (path: string) => Promise<string>;
  fetch?: typeof fetch;
  nowS?: () => number;
  /** esign-anchor · log (test bắt cảnh báo fallback). */
  log?: { warn: (msg: string, f: Record<string, unknown>) => void };
};

const oauthUrl = (host: string) => (host.includes("://") ? host : `https://${host}`);
const audOf = (host: string) => host.replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "");

async function errorCodeOf(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { errorCode?: unknown; error?: unknown };
    const code = j.errorCode ?? j.error;
    return typeof code === "string" ? code.slice(0, 60) : "";
  } catch {
    return "";
  }
}

/** Tab đặt theo anchor ẩn của trang ký (`signaturePageHtml`); thiếu anchor ⇒ DocuSign báo lỗi (không bỏ qua). */
const anchorTab = (anchorString: string, off: { x: string; y: string }) => ({
  anchorString,
  anchorUnits: "pixels",
  anchorXOffset: off.x,
  anchorYOffset: off.y,
  anchorIgnoreIfNotPresent: "false",
});
/** esign-anchor · tab theo cụm trong văn bản HĐ: nguyên từ, không phân biệt hoa thường; thiếu ⇒ lỗi (để gửi lại bằng trang ký). */
const textTab = (anchorString: string, off: { x: string; y: string }) => ({
  ...anchorTab(anchorString, off),
  anchorMatchWholeWord: "true",
  anchorCaseSensitive: "false",
});

type CreateIn = Parameters<ESignProvider["createEnvelope"]>[0];
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

/** Thân POST /envelopes. `anchors` (cụm văn bản cho từng người ký) ⇒ chỉ tài liệu HĐ, ô ký dưới cụm (quyết định: BỎ trang ký cuối
 *  khi đặt được mọi người ký — tránh trang thừa và tránh cụm lặp lại trên trang thông tin). null ⇒ HĐ + trang ký cuối (anchor ẩn). */
export function envelopeBody(i: CreateIn, anchors: string[] | null) {
  const doc = {
    documentId: "1",
    name: i.document.name,
    fileExtension: "pdf",
    documentBase64: b64(i.document.bytes),
  };
  // esign-multi · trang ký cuối = HTML UTF-8 (DocuSign tự chuyển PDF, giữ dấu); ô ký/ngày đặt theo anchor ẩn.
  const page = {
    documentId: "2",
    name: "trang-ky.html",
    fileExtension: "html",
    documentBase64: b64(
      new TextEncoder().encode(
        signaturePageHtml({
          title: i.title,
          number: i.number,
          signers: i.signers.map((s) => ({ role: s.role, name: s.name, email: s.email })),
        }),
      ),
    ),
  };
  const tabsOf = (n: number) => {
    const a = anchors?.[n];
    return a
      ? {
          signHereTabs: [textTab(a, TEXT_TAB_OFFSET.sign)],
          dateSignedTabs: [textTab(a, TEXT_TAB_OFFSET.date)],
        }
      : {
          signHereTabs: [anchorTab(signAnchors(n).sign, SIGN_TAB_OFFSET.sign)],
          dateSignedTabs: [anchorTab(signAnchors(n).date, SIGN_TAB_OFFSET.date)],
        };
  };
  return {
    emailSubject: i.subject.slice(0, 100),
    status: "sent",
    documents: anchors ? [doc] : [doc, page],
    recipients: {
      signers: i.signers.map((s, n) => ({
        email: s.email,
        name: s.name,
        recipientId: String(n + 1),
        routingOrder: String(s.order),
        ...(s.clientUserId ? { clientUserId: s.clientUserId } : {}),
        tabs: tabsOf(n),
      })),
    },
  };
}

export function docusignProvider(cfg: ESignConfig, d: Deps = {}): ESignProvider {
  const http = d.fetch ?? fetch;
  const nowS = d.nowS ?? (() => Math.floor(Date.now() / 1000));
  const readKey = d.readKey ?? ((p: string) => Bun.file(p).text());
  let key: Promise<string> | null = null;
  let token: { value: string; exp: number } | null = null;

  const accessToken = async (): Promise<string> => {
    const now = nowS();
    if (token && now < token.exp - SKEW_S) return token.value;
    key ??= readKey(cfg.privateKeyFile).catch((e) => {
      key = null;
      throw new ESignProviderError(`key-unreadable ${(e as Error).name}`);
    });
    const assertion = docusignJwt({
      integrationKey: cfg.integrationKey,
      userId: cfg.userId,
      oauthHost: audOf(cfg.oauthHost),
      privateKeyPem: await key,
      nowS: now,
    });
    const res = await http(`${oauthUrl(cfg.oauthHost)}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((e: Error) => {
      throw new ESignProviderError(`oauth-network ${e.name}`);
    });
    if (!res.ok) throw new ESignProviderError(`oauth ${res.status} ${await errorCodeOf(res)}`);
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new ESignProviderError("oauth no-token");
    token = { value: j.access_token, exp: now + (j.expires_in ?? 3600) };
    return token.value;
  };

  const api = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const res = await http(
      `${cfg.baseUri}/v2.1/accounts/${encodeURIComponent(cfg.accountId)}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    ).catch((e: Error) => {
      throw new ESignProviderError(`api-network ${e.name}`);
    });
    if (res.status === 401) token = null;
    if (!res.ok) throw new ESignProviderError(`api ${res.status} ${await errorCodeOf(res)}`);
    return res;
  };
  const env = (id: string) => `/envelopes/${encodeURIComponent(id)}`;

  return {
    key: "docusign",
    demo: false,
    // Connect: HMAC-SHA256 bắt buộc (không khoá ⇒ từ chối); chỉ tin envelopeId của thân đã xác thực.
    webhook: (raw, header) => {
      const sigs = [1, 2, 3, 4, 5]
        .map((n) => header(`x-docusign-signature-${n}`))
        .filter((s): s is string => typeof s === "string" && s !== "");
      if (!connectHmacOk(cfg.hmacKey, raw, sigs)) return { ok: false };
      try {
        return {
          ok: true,
          envelopeId: envelopeIdOfWebhook(JSON.parse(new TextDecoder().decode(raw))),
        };
      } catch {
        return { ok: true, envelopeId: null };
      }
    },
    async createEnvelope(i) {
      const post = async (anchors: string[] | null) => {
        const res = await api("POST", "/envelopes", envelopeBody(i, anchors));
        const j = (await res.json()) as { envelopeId?: string };
        if (!j.envelopeId) throw new ESignProviderError("create no-envelope-id");
        return j.envelopeId;
      };
      const anchors = i.anchors && i.anchors.length === i.signers.length ? i.anchors : null;
      if (!anchors) return { envelopeId: await post(null), placement: "page" };
      try {
        return { envelopeId: await post(anchors), placement: "text" };
      } catch (e) {
        // esign-anchor · PDF lưu chữ khác dạng ⇒ DocuSign không thấy cụm ⇒ gửi lại MỘT lần bằng trang ký cuối. Log không PII.
        if (!(e instanceof ESignProviderError) || !/ANCHOR/i.test(e.detail)) throw e;
        (d.log ?? logger).warn("esign-anchor-fallback", { detail: e.detail });
        return { envelopeId: await post(null), placement: "page" };
      }
    },
    async getEnvelope(id): Promise<ESignEnvelopeInfo> {
      const j = (await (await api("GET", `${env(id)}?include=recipients`)).json()) as {
        status?: string;
        voidedReason?: string;
        completedDateTime?: string;
        recipients?: {
          signers?: {
            email: string;
            status?: string;
            signedDateTime?: string;
            declinedReason?: string;
          }[];
        };
      };
      const signers = j.recipients?.signers ?? [];
      const declined = signers.find((s) => s.declinedReason)?.declinedReason;
      return {
        status: j.status ?? "",
        reason: (j.voidedReason ?? declined ?? null)?.slice(0, 500) ?? null,
        completedAt: j.completedDateTime ?? null,
        recipients: signers.map((s) => ({
          email: s.email,
          status: s.status ?? null,
          signedAt: s.signedDateTime ?? null,
        })),
      };
    },
    async recipientView(id, r, returnUrl) {
      const res = await api("POST", `${env(id)}/views/recipient`, {
        returnUrl,
        authenticationMethod: "none",
        email: r.email,
        userName: r.name,
        clientUserId: r.clientUserId,
      });
      const j = (await res.json()) as { url?: string };
      if (!j.url) throw new ESignProviderError("view no-url");
      return j.url;
    },
    async combinedPdf(id) {
      return new Uint8Array(
        await (await api("GET", `${env(id)}/documents/combined`)).arrayBuffer(),
      );
    },
    async voidEnvelope(id, reason) {
      await api("PUT", env(id), { status: "voided", voidedReason: reason });
    },
  };
}
