// V2-I · DT-01 · DT-06 · DT-07 · intake Q8 (làn nhanh — một int đường chính mỗi endpoint mới, hub-api THẬT): hồ sơ đầu trang, HĐ + giai
// đoạn + số HĐ, "Tìm trên internet" (AI QUA gói: CLI giả ghi lại lời nhắc/đối số — chỉ tên + MST, đúng MỘT công cụ WebSearch, dòng usage
// `contracts.partner-search` billing subscription), lưu dòng vào ghi chú (nguồn `internet`). Đối tác ngoài phạm vi ⇒ 404.
// CLI giả = script bun có shebang (Linux/evotest); KHÔNG gọi AI thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  arrangeV2e,
  type CtxN1,
  call,
  contract,
  milestones,
  ok,
  P,
  startHd1,
} from "../V2-E/_support/v2e";

const DIR = join(tmpdir(), `v2i-fake-claude-${process.pid}`);
const IN = join(DIR, "stdin.txt");
const ARGS = join(DIR, "args.json");
const REPLY = [
  {
    title: "Đăng ký doanh nghiệp",
    summary: "Đang hoạt động, thành lập 2012",
    source: "masothue.com",
  },
  {
    title: "Website chính thức",
    summary: "Có trang giới thiệu và bảng giá",
    source: "ncc-minh-an.vn",
  },
];
const FAKE = `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(ARGS)}, JSON.stringify(process.argv.slice(2)));
writeFileSync(${JSON.stringify(IN)}, await Bun.stdin.text());
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false,
  result: ${JSON.stringify(JSON.stringify(REPLY))}, usage: { input_tokens: 120, output_tokens: 80 } }));
`;

let c: CtxN1;
const saved = { cli: process.env.AI_SUB_CLI_PATH, mode: process.env.AI_PROVIDER };
beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  const cli = join(DIR, "claude");
  writeFileSync(cli, FAKE);
  chmodSync(cli, 0o755);
  process.env.AI_SUB_CLI_PATH = cli; // chọn gói thay vì `off` của APP_ENV=test (đọc lúc dựng hub)
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
  if (saved.cli === undefined) delete process.env.AI_SUB_CLI_PATH;
  else process.env.AI_SUB_CLI_PATH = saved.cli;
});

const enc = encodeURIComponent;
const A = "tax:0301000001";
const B = "tax:0301000002";

describe("V2-I · API Đối tác UI v2", () => {
  it("hồ sơ + HĐ theo giai đoạn + số HĐ + tìm internet (chỉ tên + MST) + lưu ghi chú nguồn internet", async () => {
    await arrangeV2e(c);
    await c.sql`truncate contracts.partner_notes`;
    const a = await contract(c.sql, {
      deal: "buy",
      tax: "0301000001",
      name: "NCC Minh An",
      group: "service",
    });
    await milestones(c.sql, a, A, [{ kind: "delivery", done: -20 }]);
    const b = await contract(c.sql, {
      deal: "sell",
      tax: "0301000002",
      name: "Khách Bình",
      group: "goods",
    });
    await milestones(c.sql, b, B, [{ kind: "payment", done: -10 }]);
    // HĐ của Bình còn một mốc mở ⇒ đang thực hiện, có bước kế (quá hạn)
    await c.sql`insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, status,
        owner, title) values (${P.hoa.tid}, ${b}, ${B}, 'receive', 'payment', 9, ${new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10)},
        'open', 'partner', 'Thanh toán đợt 2')`;

    // DT-01 hồ sơ: tên + MST theo khoá đối tác; liên hệ = người đại diện bên đối tác ở HĐ mới nhất (chưa có ⇒ null)
    const prof = await ok(call(c, P.hoa, "GET", `/partners/profile?party=${enc(A)}`));
    expect(prof).toMatchObject({
      party: A,
      name: "NCC Minh An",
      tax_id: "0301000001",
      phone: null,
    });

    // DT-06 HĐ của đối tác + giai đoạn; DT-01 số HĐ mỗi đối tác
    const ca = (await ok(call(c, P.hoa, "GET", `/partners/contracts?party=${enc(A)}`))) as {
      id: string;
      stage: string;
    }[];
    expect(ca.map((x) => [x.id, x.stage])).toEqual([[a, "done"]]);
    const cb = (await ok(call(c, P.hoa, "GET", `/partners/contracts?party=${enc(B)}`))) as {
      stage: string;
      next: { title: string; overdue: boolean } | null;
    }[];
    expect(cb[0]?.stage).toBe("in_progress");
    expect(cb[0]?.next).toMatchObject({ title: "Thanh toán đợt 2", overdue: true });
    const counts = (await ok(call(c, P.hoa, "GET", "/partners/contract-counts"))) as {
      party: string;
      n: number;
    }[];
    expect(Object.fromEntries(counts.map((x) => [x.party, x.n]))).toEqual({ [A]: 1, [B]: 1 });

    // DT-07 · Q8: gọi AI QUA gói — lời nhắc chỉ có tên + MST, đúng một công cụ WebSearch, usage ghi `subscription`
    const found = (await ok(call(c, P.hoa, "POST", "/partners/internet-search", { party: A }))) as {
      lines: { title: string; summary: string; source: string | null }[];
    };
    expect(found.lines).toEqual(REPLY);
    expect(readFileSync(IN, "utf8")).toBe("Tên doanh nghiệp: NCC Minh An\nMã số thuế: 0301000001");
    const argv = JSON.parse(readFileSync(ARGS, "utf8")) as string[];
    const t = argv.indexOf("--tools");
    expect(argv.slice(t, t + 4)).toEqual(["--tools", "WebSearch", "--allowedTools", "WebSearch"]);
    const [u] = await c.sql<
      { n: number; billing: string }[]
    >`select count(*)::int as n, min(billing) as billing
      from hub.usage_logs where tenant_id = ${P.hoa.tid} and feature = 'contracts.partner-search'`;
    expect(u).toEqual({ n: 1, billing: "subscription" });

    // lưu một dòng vào ghi chú (nguồn internet) ⇒ hiện trong danh sách ghi chú
    const body = `${REPLY[0]?.title}: ${REPLY[0]?.summary} (${REPLY[0]?.source})`;
    const note = await ok(
      call(c, P.hoa, "POST", "/partners/notes", { party: A, body, source: "internet" }),
    );
    expect(note).toMatchObject({ party: A, body, source: "internet" });
    const notes = (await ok(call(c, P.hoa, "GET", `/partners/notes?party=${enc(A)}`))) as {
      source: string;
    }[];
    expect(notes.map((x) => x.source)).toEqual(["internet"]);

    // đối tác ngoài phạm vi / tenant khác ⇒ 404 (không lộ, không gọi AI)
    for (const [m, path, body2] of [
      ["GET", `/partners/profile?party=${enc(A)}`, undefined],
      ["POST", "/partners/internet-search", { party: A }],
    ] as const) {
      const r = await call(c, P.an, m, path, body2);
      expect({ path, status: r.status }).toEqual({ path, status: 404 });
    }
    const [u2] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.usage_logs
      where feature = 'contracts.partner-search'`;
    expect(u2?.n).toBe(1);
  });
});
