// HUB-FR-95 · HUB-BR-20 · AC-H22 · HUB-FR-50 · H2a-R18, R21, R22 · xác nhận `side_effect` + băm token job
// (test-plan H2a §4 R56–R59, cases §1.8; câu nguyên văn plan-errors §5; chữ ký plan-rules, plan P4).
import { describe, expect, it } from "bun:test";
import { ToolConfirmationRequiredSchema } from "@ai/contracts/hub-internal";
import { hashJobToken } from "../../../../apps/hub-api/src/lib/job-token";
import {
  confirmationInstruction,
  confirmationPrompt,
  isAgreeReply,
} from "../../../../apps/hub-api/src/modules/mcp/confirm.rules";

const Q_VI = "Thao tác này sẽ thay đổi dữ liệu ở hệ thống bên ngoài. Bạn có muốn tiếp tục?";
const Q_EN = "This action will change data in an external system. Do you want to continue?";
const I_VI =
  "CONFIRMATION_REQUIRED: Công cụ này cần người dùng xác nhận trước. Dừng lại và trả need_input với đúng question và choices trong structuredContent; không gọi lại công cụ trong lượt này.";
const I_EN =
  "CONFIRMATION_REQUIRED: This tool needs user confirmation first. Stop and return need_input with exactly the question and choices in structuredContent; do not call the tool again this turn.";

// Vector dùng chung P01/P28 (sha256 tính độc lập bằng `sha256sum`). Token thử, không thật.
const VECTORS = [
  {
    token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    sha256: "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a",
  },
  {
    token: "test_job-token-vector_0123456789_abcdefghij",
    sha256: "612aac117a8936eada56e1dfb1a962d6c062699c16440affb607229af893ff22",
  },
];

describe("HUB-FR-95 · xác nhận side_effect [R56–R58]", () => {
  it("HUB-FR-95 · HUB-BR-20 · isAgreeReply: NFC, trim, lower ∈ {đồng ý, agree} [R56]", () => {
    const yes = ["Đồng ý", " đồng ý ", "ĐỒNG Ý", "Đồng ý".normalize("NFD"), "Agree", "agree "];
    for (const s of yes) expect({ s, r: isAgreeReply(s) }).toEqual({ s, r: true });
    const no = ["Đồng ý.", "ok", "Huỷ", "đồng ý luôn", "", "/dich"];
    for (const s of no) expect({ s, r: isAgreeReply(s) }).toEqual({ s, r: false });
  });

  it("HUB-FR-95 · AC-H22 · confirmationPrompt nguyên văn plan-errors §5 [R57]", () => {
    expect(confirmationPrompt("vi")).toEqual({ question: Q_VI, choices: ["Đồng ý", "Huỷ"] });
    expect(confirmationPrompt("en")).toEqual({ question: Q_EN, choices: ["Agree", "Cancel"] });
    const parsed = ToolConfirmationRequiredSchema.safeParse({
      code: "CONFIRMATION_REQUIRED",
      ...confirmationPrompt("vi"),
    });
    expect(parsed.success).toBe(true);
  });

  it("HUB-FR-95 · AC-H22 · confirmationInstruction nguyên văn plan-errors §5 [R58]", () => {
    expect(confirmationInstruction("vi")).toBe(I_VI);
    expect(confirmationInstruction("en")).toBe(I_EN);
  });
});

describe("HUB-FR-50 · token job [R59]", () => {
  it("HUB-FR-50 · WRK-FR-13 · hashJobToken = sha256 ASCII 32 byte (vector chung Python) [R59]", () => {
    for (const v of VECTORS) {
      const h = hashJobToken(v.token);
      expect(h.length).toBe(32);
      expect(Buffer.from(h).toString("hex")).toBe(v.sha256);
    }
  });
});
