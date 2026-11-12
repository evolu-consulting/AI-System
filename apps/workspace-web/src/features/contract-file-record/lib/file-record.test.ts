// CR-135 · Q5 · gom dữ liệu «Hồ sơ» của file HĐ: loại tệp, tên người, bằng chứng của bước nào, khối ký.
import { describe, expect, test } from "bun:test";
import type { ESignStateOut } from "@ai/contracts/pack-contracts";
import type { RecordLine } from "~/features/contract-approval/lib/record-view";
import { evidenceStepsOf, mimeKind, nameOf, signBlock } from "./file-record";

const line = (stage: string, fileIds: string[], signatureId: string | null = null): RecordLine => ({
  key: stage + fileIds.join(),
  stage,
  action: "approve",
  who: "A",
  onBehalf: null,
  at: "2026-11-12T00:00:00Z",
  note: null,
  hasEvidence: true,
  readable: true,
  signatureId,
  fileIds,
  evidenceId: "e",
});
const base = {
  configured: true,
  enabled: true,
  defaults: [],
  ready: true,
} as unknown as ESignStateOut;

describe("CR-135 Q5 · hồ sơ file", () => {
  test("loại tệp theo MIME", () => {
    expect(mimeKind("application/pdf")).toBe("pdf");
    expect(mimeKind("image/png")).toBe("image");
    expect(
      mimeKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("word");
    expect(mimeKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(
      "excel",
    );
    expect(mimeKind("application/zip")).toBe("other");
  });
  test("tên người: có ⇒ tên, lạ/không có ⇒ null", () => {
    expect(nameOf([{ id: "u1", name: "Bình" }], "u1")).toBe("Bình");
    expect(nameOf([{ id: "u1", name: "Bình" }], "u2")).toBeNull();
    expect(nameOf(undefined, null)).toBeNull();
  });
  test("tệp là bằng chứng của bước nào (không trùng, giữ thứ tự)", () => {
    const ls = [line("Trưởng phòng", ["f1"]), line("Giám đốc", ["f2"], "f1"), line("Kế toán", [])];
    expect(evidenceStepsOf("f1", ls)).toEqual(["Trưởng phòng", "Giám đốc"]);
    expect(evidenceStepsOf("zzz", ls)).toEqual([]);
  });
  test("không ký số ⇒ none; có ký số nhưng chưa gửi ⇒ notSent", () => {
    expect(signBlock(undefined).mode).toBe("none");
    expect(signBlock({ ...base, enabled: false, envelope: null }).mode).toBe("none");
    expect(signBlock({ ...base, envelope: null }).mode).toBe("notSent");
  });
  test("phong bì: từng bên ký theo thứ tự, đã ký ⇒ nhãn «Đã ký», có bản đã ký", () => {
    const b = signBlock({
      ...base,
      envelope: {
        id: "x",
        provider: "selfsign",
        provider_label: "Ký thử",
        demo: true,
        status: "completed",
        reason: null,
        completed_at: "2026-11-12T01:00:00Z",
        created_at: "2026-11-12T00:00:00Z",
        has_signed_file: true,
        signers: [
          {
            role: "partner",
            name: "B",
            email: "b@x",
            order: 2,
            embedded: false,
            status: "sent",
            signed_at: null,
            provider: null,
            certificate_ref: null,
          },
          {
            role: "company",
            name: "A",
            email: "a@x",
            order: 1,
            embedded: true,
            status: "completed",
            signed_at: "2026-11-12T00:30:00Z",
            provider: null,
            certificate_ref: null,
          },
        ],
      },
    } as ESignStateOut);
    if (b.mode !== "envelope") throw new Error("envelope");
    expect(b.done).toBe(true);
    expect(b.hasSignedFile).toBe(true);
    expect(b.signers.map((s) => s.name)).toEqual(["A", "B"]);
    expect(b.signers[0]?.labelKey).toBe("contracts.esign.signed");
    expect(b.signers[1]?.at).toBeNull();
  });
});
