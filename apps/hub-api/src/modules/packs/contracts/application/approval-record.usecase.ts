// CR-127 · E4 · `GET /contracts/:id/approval-record` — hồ sơ duyệt: mọi quyết định + bằng chứng, lọc theo BR-26 (người chỉ xem không
// thấy ý kiến/tệp). Lớp 2: chỉ cổng. Hai lần đọc: (1) tx gói: trạng thái lượt + `stage_decided` + bằng chứng (MỘT câu, DEFINER theo
// tenant); (2) `stepsView` của engine (tên người, ai quyết được bước đang mở). HĐ không thấy / tenant khác ⇒ null (404).
import type { ApprovalRecord } from "@ai/contracts/pack-contracts";
import type { PackWho } from "../../kit/public";
import { renderApprovalRecordPdf } from "../adapters/approval-record.pdf";
import { buildApprovalRecord, canReadEvidence } from "../domain/approval-record.rules";
import type { ApprovalState } from "./approval.ports";
import type { ApprovalEngineRepo } from "./approval-engine.ports";
import type { EngineCardDeps } from "./approval-engine-card.usecase";

type RecordRepos = {
  approval: { state(id: string, o: { lock: boolean }): Promise<unknown> };
  approvalEngine: Pick<ApprovalEngineRepo, "decisionsOf"> & {
    labels?: ApprovalEngineRepo["labels"];
  };
};
export type ApprovalRecordDeps = Pick<
  EngineCardDeps,
  "port" | "isAdmin" | "evidenceBytes" | "evidenceNames"
> & {
  uow: { tenant<T>(who: PackWho, fn: (r: RecordRepos) => Promise<T>): Promise<T> };
};

/** Hồ sơ đã đọc + người xem có được đọc NỘI DUNG bằng chứng không (BR-26). HĐ không thấy / tenant khác ⇒ null. */
async function loadRecord(d: ApprovalRecordDeps, who: PackWho, id: string) {
  const got = await d.uow.tenant(who, async (r) => {
    const st = (await r.approval.state(id, { lock: false })) as ApprovalState | null;
    if (!st) return null;
    const rows = (await r.approvalEngine.decisionsOf?.(id)) ?? [];
    const label = (await r.approvalEngine.labels?.([id]))?.[0]; // tên HĐ (một nguồn `contractNameSql`) — cho PDF
    return { st, rows, label };
  });
  if (!got) return null;
  const a = got.st.approval;
  const port = d.port();
  const sv =
    port && a?.engineRunId ? await port.stepsView({ ...who, role: "member" }, a.engineRunId) : null;
  const names = new Map<string, string>();
  const involved = new Set<string>(got.rows.map((x) => x.actor));
  for (const s of sv?.steps ?? []) {
    if (s.decided_by) {
      names.set(s.decided_by.id, s.decided_by.name);
      involved.add(s.decided_by.id);
    }
    if (s.task?.can_act) involved.add(who.userId); // quyết được bước đang mở (kể cả trưởng phòng duyệt)
  }
  const admin = (await d.isAdmin?.(who)) ?? false;
  const readable = canReadEvidence(
    { userId: who.userId, admin },
    { startedBy: a?.startedBy ?? "", owner: got.st.owner ?? null, involved },
  );
  return { rows: got.rows, names, readable, label: got.label };
}

export function approvalRecord(d: ApprovalRecordDeps) {
  return async (who: PackWho, id: string): Promise<ApprovalRecord | null> => {
    const rec = await loadRecord(d, who, id);
    if (!rec) return null;
    const out: ApprovalRecord = buildApprovalRecord(rec.rows, rec.names, rec.readable);
    if (!rec.readable || !d.evidenceNames) return out;
    // CR-144 · MỘT câu theo lô: tên + loại tệp của mọi bằng chứng đọc được (không truy vấn theo từng tệp).
    const meta = await d.evidenceNames(
      who.tenantId,
      out.items.flatMap((x) => (x.evidence?.readable ? [x.evidence.id] : [])),
    );
    const items = out.items.map((x) => {
      if (!x.evidence) return x;
      const ids = [
        ...(x.evidence.signature_attachment_id ? [x.evidence.signature_attachment_id] : []),
        ...x.evidence.attachment_ids,
      ];
      const files = ids.flatMap((id) => {
        const m = meta.get(id);
        return m ? [{ id, name: m.name, mime: m.mime }] : [];
      });
      return { ...x, evidence: { ...x.evidence, files } };
    });
    return { ...out, items };
  };
}

/**
 * CR-127 · U4b-3 · PDF "Hồ sơ duyệt": dựng từ CHÍNH `buildApprovalRecord` (một nguồn với JSON, đã lọc BR-26) + tên HĐ + tên tệp bằng chứng
 * (một câu theo lô, CHỈ khi người xem đọc được nội dung). HĐ không thấy / tenant khác ⇒ null (404).
 */
export function approvalRecordPdf(d: ApprovalRecordDeps, now: () => Date = () => new Date()) {
  return async (who: PackWho, id: string): Promise<{ name: string; bytes: Uint8Array } | null> => {
    const rec = await loadRecord(d, who, id);
    if (!rec) return null;
    const out = buildApprovalRecord(rec.rows, rec.names, rec.readable);
    const evIds = out.items.flatMap((x) => (x.evidence?.readable ? [x.evidence.id] : []));
    const fileNames = new Map<string, string>();
    if (rec.readable && d.evidenceNames)
      for (const [k, m] of await d.evidenceNames(who.tenantId, evIds)) fileNames.set(k, m.name);
    const bytes = await renderApprovalRecordPdf({
      contract: { name: rec.label?.title ?? "", number: rec.label?.number ?? null },
      items: out.items,
      canReadEvidence: out.can_read_evidence,
      fileNames,
      generatedAt: now().toISOString(),
    });
    return {
      name: `ho-so-duyet-${rec.label?.number ?? id.slice(0, 8)}.pdf`.replace(
        /[^A-Za-z0-9._-]/g,
        "-",
      ),
      bytes,
    };
  };
}

export type EvidenceFile = { name: string; mime: string; bytes: Uint8Array };

/**
 * CR-127 · E4b · tải tệp / chữ ký của bằng chứng (BR-26). Cấp byte CHỈ khi: HĐ thuộc tenant, bằng chứng nằm trong hồ sơ duyệt của HĐ này,
 * `fileId` là chữ ký hoặc tệp của CHÍNH bằng chứng đó, và người xem đọc được nội dung (`canReadEvidence`). Mọi trường hợp sai ⇒ null (404).
 */
export function approvalEvidenceFile(d: ApprovalRecordDeps) {
  return async (
    who: PackWho,
    id: string,
    evidenceId: string,
    fileId: string,
  ): Promise<EvidenceFile | null> => {
    if (!d.evidenceBytes) return null;
    const rec = await loadRecord(d, who, id);
    if (!rec?.readable) return null;
    const ev = rec.rows.find((x) => x.evidence?.id === evidenceId)?.evidence;
    if (!ev) return null;
    const f = fileId.toLowerCase();
    const own = ev.signature_attachment_id === f || ev.attachment_ids.includes(f);
    return own ? d.evidenceBytes(who.tenantId, evidenceId, f) : null;
  };
}
