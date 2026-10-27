// cf-esign-docusign · hạ tầng int: như HD1 (`startHd1`: DB X2a + hub-api THẬT + admin-api THẬT + FileBox giả) nhưng seam
// `packs.esign.provider` = adapter DocuSign THẬT trỏ tới server DocuSign GIẢ cục bộ (Bun.serve đóng vai account-d `/oauth/token` +
// restapi v2.1, kho = `fakeESign`). Server giả kiểm JWT Grant bằng khoá công khai test. KHÔNG gọi DocuSign thật. Không chứa `it(...)`.

import { expect } from "bun:test";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { createApp as createHubApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../../apps/hub-api/src/lib/redis";
import { docusignProvider } from "../../../../apps/hub-api/src/modules/packs/contracts/adapters/docusign.provider";
import {
  type FakeESign,
  fakeESign,
} from "../../../../apps/hub-api/src/modules/packs/contracts/adapters/esign.fake";
import type { ESignProvider } from "../../../../apps/hub-api/src/modules/packs/contracts/application/esign.ports";
import { startFbFake } from "../../FB1/_fbfake";
import {
  call,
  HUB_API_URL,
  type HubDeps,
  makeKeys,
  REDIS_TEST_URL,
  sign,
} from "../../H1/_fixtures";
import { CK, type CtxN1, type P } from "../../HD1/_support/hd1";
import {
  type AdminN1,
  bumpConfig,
  type HubN1,
  packGroupKey,
  packsPath,
  startAdminN1,
} from "../../N1/_support/n1";
import { setupX2a } from "../../X2a/_x2a";

export const HMAC_KEY = "connect-hmac-test-key";
type Person = (typeof P)[keyof typeof P];

export type FakeDs = {
  origin: string;
  fake: FakeESign;
  tokenCalls: () => number;
  close: () => Promise<void>;
};

/** DocuSign giả: `/oauth/token` (kiểm assertion RS256) + `/restapi/v2.1/accounts/acc-1/envelopes…` dựa trên `fakeESign`. */
export function startFakeDocusign(publicKey: string): FakeDs {
  const fake = fakeESign();
  let tokens = 0;
  const j = (b: unknown, status = 200) => Response.json(b, { status });
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/oauth/token") {
        const f = new URLSearchParams(await req.text());
        const [h, p, s] = (f.get("assertion") ?? "").split(".");
        const v = createVerify("RSA-SHA256");
        v.update(`${h}.${p}`);
        if (!s || !v.verify(publicKey, Buffer.from(s, "base64url")))
          return j({ error: "invalid_grant" }, 400);
        tokens += 1;
        return j({ access_token: `tok-${tokens}`, token_type: "Bearer", expires_in: 3600 });
      }
      if (!/^Bearer tok-\d+$/.test(req.headers.get("authorization") ?? ""))
        return j({ errorCode: "AUTH" }, 401);
      const m = /^\/restapi\/v2\.1\/accounts\/acc-1\/envelopes(?:\/([^/]+))?(\/.*)?$/.exec(
        u.pathname,
      );
      if (!m) return j({ errorCode: "NOT_FOUND" }, 404);
      return route(fake, req, m[1], m[2] ?? "").catch(() =>
        j({ errorCode: "ENVELOPE_DOES_NOT_EXIST" }, 400),
      );
    },
  });
  return {
    origin: `http://localhost:${server.port}`,
    fake,
    tokenCalls: () => tokens,
    close: async () => {
      await server.stop(true);
    },
  };
}

type DsSigner = { email: string; name: string; routingOrder: string; clientUserId?: string };
async function route(
  fake: FakeESign,
  req: Request,
  id: string | undefined,
  rest: string,
): Promise<Response> {
  if (!id && req.method === "POST") {
    const b = (await req.json()) as {
      emailSubject: string;
      documents: { documentBase64: string; name: string }[];
      recipients: { signers: DsSigner[] };
    };
    const r = await fake.createEnvelope({
      subject: b.emailSubject,
      document: {
        name: b.documents[0]?.name ?? "",
        bytes: Buffer.from(b.documents[0]?.documentBase64 ?? "", "base64"),
      },
      signers: b.recipients.signers.map((s) => ({
        name: s.name,
        email: s.email,
        order: Number(s.routingOrder),
        clientUserId: s.clientUserId ?? null,
      })),
    });
    return Response.json({ envelopeId: r.envelopeId, status: "sent" }, { status: 201 });
  }
  const eid = decodeURIComponent(id ?? "");
  if (rest === "" && req.method === "GET") {
    const e = await fake.getEnvelope(eid);
    return Response.json({
      status: e.status,
      voidedReason: e.status === "voided" ? e.reason : undefined,
      completedDateTime: e.completedAt ?? undefined,
      recipients: {
        signers: e.recipients.map((x) => ({
          email: x.email,
          status: x.status,
          signedDateTime: x.signedAt ?? undefined,
          declinedReason: e.status === "declined" ? e.reason : undefined,
        })),
      },
    });
  }
  if (rest === "" && req.method === "PUT") {
    const b = (await req.json()) as { voidedReason: string };
    await fake.voidEnvelope(eid, b.voidedReason);
    return Response.json({ envelopeId: eid });
  }
  if (rest === "/views/recipient") {
    const b = (await req.json()) as {
      name: string;
      email: string;
      clientUserId: string;
      returnUrl: string;
    };
    return Response.json({ url: await fake.recipientView(eid, b, b.returnUrl) });
  }
  if (rest === "/documents/combined") return new Response(await fake.combinedPdf(eid));
  return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 });
}

export type EsignCtx = CtxN1 & { ds: FakeDs; offHub: HubN1 };

async function startHub(
  k: Awaited<ReturnType<typeof makeKeys>>,
  fbOrigin: string,
  fbToken: string,
  provider: ESignProvider | null,
): Promise<HubN1> {
  const db = connectDb(HUB_API_URL, 4);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId: `qc-esign-${provider ? 1 : 0}`,
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 2,
    packs: { contracts: true, filebox: { url: fbOrigin, token: fbToken }, esign: { provider } },
  } as HubDeps & Record<string, unknown>;
  const app = createHubApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  return {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    instanceId: deps.instanceId as string,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
}

/** Hub có DocuSign (server giả) + hub thứ hai KHÔNG cấu hình ký số (`provider: null`). */
export async function startEsign(): Promise<EsignCtx> {
  const sql = await setupX2a();
  const k = await makeKeys();
  const fb = startFbFake();
  const kp = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const ds = startFakeDocusign(kp.publicKey);
  const provider = docusignProvider(
    {
      integrationKey: "ik-test",
      userId: "ds-user",
      accountId: "acc-1",
      baseUri: `${ds.origin}/restapi`,
      oauthHost: ds.origin,
      privateKeyFile: "(in-memory)",
      hmacKey: HMAC_KEY,
    },
    { readKey: async () => kp.privateKey },
  );
  const hub = await startHub(k, fb.origin, fb.token, provider);
  const offHub = await startHub(k, fb.origin, fb.token, null);
  const admin: AdminN1 = await startAdminN1(k);
  const tok = (p: Person) => sign(k, p);
  return {
    sql,
    k,
    hub,
    fb,
    admin,
    tok,
    ds,
    offHub,
    hubCall: async (p, method, path, body) =>
      call(hub, method, path, { token: await tok(p), body }),
    enable: async (tenantId, key = CK) => {
      const r = await admin.call("PUT", packsPath(tenantId, key));
      expect({ status: r.status }).toEqual({ status: 200 });
      return r.json;
    },
    addToRole: async (tenantId, role, who, key = CK) => {
      const [g] = await sql<{ id: string }[]>`select id from admin.groups
        where tenant_id = ${tenantId} and key = ${packGroupKey(key, role)}`;
      await sql`insert into admin.group_members ${sql(
        who.map((p) => ({ tenant_id: tenantId, group_id: g?.id as string, user_id: p.id })),
      )} on conflict do nothing`;
      await bumpConfig(sql, tenantId);
    },
    stop: async () => {
      await hub.stop();
      await offHub.stop();
      await admin.close();
      await fb.close();
      await ds.close();
      await sql.end();
    },
  } as EsignCtx;
}
