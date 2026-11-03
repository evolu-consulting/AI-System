// CR-114 hub-binary-wire · đo JSON vs msgpack (msgpackr) trên mẫu thật của các đường service-to-service.
// Chạy: `bun apps/hub-api/scripts/wire-bench.ts` (in bảng markdown). Không phải test; số liệu ghi ở docs/specs/hub-binary-wire/tasks.md.
import { RunEventSchema } from "@ai/contracts/hub";
import { Packr } from "msgpackr";

const packr = new Packr({ useRecords: false });
const JOB = "7d0b6d5e-3c1c-4f55-9d0e-1f3a8f6d2a11";
const AT = "2026-11-03T06:41:12.345678+00:00";
const VI =
  "Điều 12. Nghĩa vụ của bên B: bên B có trách nhiệm thanh toán đầy đủ và đúng hạn theo phụ lục hợp đồng; trường hợp chậm thanh toán quá 15 ngày, bên A có quyền tạm ngừng cung cấp dịch vụ. ";
const text = (n: number): string => VI.repeat(Math.ceil(n / VI.length)).slice(0, n);

type Sample = { name: string; path: string; value: unknown; zod: boolean };
const base = (seq: number, type: string) => ({ v: 1, seq, at: AT, type, job_id: JOB });
const samples: Sample[] = [
  {
    name: "job.delta 200ch (flush mặc định)",
    path: "run:<id>",
    zod: true,
    value: { ...base(7, "job.delta"), kind: "answer", text: text(200) },
  },
  {
    name: "job.delta 1000ch",
    path: "run:<id>",
    zod: true,
    value: { ...base(8, "job.delta"), kind: "answer", text: text(1000) },
  },
  {
    name: "job.delta 4000ch (trần)",
    path: "run:<id>",
    zod: true,
    value: { ...base(9, "job.delta"), kind: "answer", text: text(4000) },
  },
  {
    name: "job.progress",
    path: "run:<id>",
    zod: true,
    value: { ...base(2, "job.progress"), message: "Đang đọc tài liệu nguồn (3/8)", percent: 37 },
  },
  {
    name: "job.started",
    path: "run:<id>",
    zod: true,
    value: {
      ...base(1, "job.started"),
      worker_id: "worker-hub-01",
      provider_key: "contracts.extract",
    },
  },
  {
    name: "job.result (text 3000ch)",
    path: "run:<id>",
    zod: true,
    value: {
      ...base(30, "job.result"),
      output: { kind: "text", text: text(3000) },
      usage: { input_tokens: 5231, output_tokens: 812 },
      session_resumed: false,
    },
  },
  {
    name: "ustream message event (~600B)",
    path: "ustream:<uid>",
    zod: false,
    value: {
      event: "message.created",
      data: {
        room_id: JOB,
        message: {
          id: JOB,
          author_id: JOB,
          kind: "text",
          content: text(280),
          created_at: AT,
          mentions: [],
          reply_to: null,
        },
      },
    },
  },
  {
    name: "pg_notify job_enqueued",
    path: "NOTIFY",
    zod: false,
    value: { v: 1, job_id: JOB, provider_key: "contracts.extract" },
  },
  {
    name: "hub.jobs.payload (prompt 2KB)",
    path: "hub.jobs.payload",
    zod: false,
    value: {
      v: 1,
      provider_key: "contracts.extract",
      prompt: text(2000),
      params: { locale: "vi", max_tokens: 4096, files: [JOB, JOB] },
      timeout_s: 600,
    },
  },
];

function timeIt(fn: () => unknown, iters: number): number {
  for (let i = 0; i < iters / 10; i++) fn();
  const t0 = Bun.nanoseconds();
  for (let i = 0; i < iters; i++) fn();
  return (Bun.nanoseconds() - t0) / iters;
}

const rows: string[] = [
  "| mẫu | đường | JSON B | msgpack B | Δ bytes | enc JSON ns | enc mp ns | dec JSON ns | dec mp ns | dec+zod JSON ns | dec+zod mp ns |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
];
for (const s of samples) {
  const iters = JSON.stringify(s.value).length > 2000 ? 100_000 : 300_000;
  const js = JSON.stringify(s.value);
  const jb = Buffer.byteLength(js);
  const mp = packr.pack(s.value);
  const delta = ((1 - mp.length / jb) * 100).toFixed(1);
  const encJ = timeIt(() => JSON.stringify(s.value), iters);
  const encM = timeIt(() => packr.pack(s.value), iters);
  const decJ = timeIt(() => JSON.parse(js), iters);
  const decM = timeIt(() => packr.unpack(mp), iters);
  let zJ = "-";
  let zM = "-";
  if (s.zod) {
    zJ = timeIt(() => RunEventSchema.safeParse(JSON.parse(js)), iters / 3).toFixed(0);
    zM = timeIt(() => RunEventSchema.safeParse(packr.unpack(mp)), iters / 3).toFixed(0);
  }
  rows.push(
    `| ${s.name} | ${s.path} | ${jb} | ${mp.length} | ${delta}% | ${encJ.toFixed(0)} | ${encM.toFixed(0)} | ${decJ.toFixed(0)} | ${decM.toFixed(0)} | ${zJ} | ${zM} |`,
  );
}
console.log(rows.join("\n"));
console.log(`\nbun ${Bun.version} · msgpackr useRecords:false`);
