// ADM-FR-23 · X1 F4 · body "Chạy thử" từ bản nháp: chỉ phần chạy được, bỏ trường rỗng, confirm_side_effect khi xác nhận.

import { describe, expect, test } from "bun:test";
import { CommandTestRequestSchema } from "@ai/contracts";
import { emptyCommandForm } from "./defaults";
import type { CommandFormValues } from "./schemas";
import { buildTestBody, emptyTestInput, pageUrlValid } from "./test-run";

const WF = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000002";
const draft = (): CommandFormValues => ({
  ...emptyCommandForm(),
  name: "dich-nhap",
  workflow_id: WF,
  output_field: "text",
  input_map: {
    target_lang: { source: "const", value: "vi" },
    source_text: { source: "selection", value: "" },
  },
});

describe("X1 F4 · buildTestBody", () => {
  test("tối thiểu: command + text, không context/run_as/confirm; khớp CommandTestRequestSchema", () => {
    const b = buildTestBody(draft(), { ...emptyTestInput(), text: "Xin chào" });
    expect(b).not.toHaveProperty("context");
    expect(b).not.toHaveProperty("run_as_user_id");
    expect(b).not.toHaveProperty("confirm_side_effect");
    expect(Object.keys(b.command).sort()).toEqual([
      "args",
      "input_map",
      "output",
      "timeout_s",
      "workflow_id",
    ]);
    expect(b.command.input_map).toEqual({
      target_lang: { source: "const", value: "vi" },
      source_text: { source: "selection" },
    });
    expect(CommandTestRequestSchema.safeParse(b).success).toBe(true);
  });
  test("đủ: context selection/page_url, run_as_user_id, confirm_side_effect", () => {
    const b = buildTestBody(
      draft(),
      { text: "x", selection: "Hello", pageUrl: " https://a.vn/p ", runAsUserId: USER },
      true,
    );
    expect(b).toMatchObject({
      context: { selection: "Hello", page_url: "https://a.vn/p" },
      run_as_user_id: USER,
      confirm_side_effect: true,
    });
    expect(CommandTestRequestSchema.safeParse(b).success).toBe(true);
  });
  test("pageUrlValid: rỗng hoặc http(s)://", () => {
    expect(pageUrlValid("")).toBe(true);
    expect(pageUrlValid("https://a.vn")).toBe(true);
    expect(pageUrlValid("ftp://a.vn")).toBe(false);
  });
});
