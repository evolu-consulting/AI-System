// HUB-FR-143…145 · CA-R03/R04 · plan-domain §6: union domain = mảng contract (typecheck + runtime), hằng domain = hằng
// contract, bảng lỗi domain đủ mã và đúng HTTP. Contract đổi ⇒ đỏ ở đây, không lan vào domain.
import { describe, expect, it } from "bun:test";
import * as chat from "@ai/contracts/chat";
import {
  type DECISION_OPTIONS,
  type DECISION_REASONS,
  type EXECUTOR_KINDS,
  type NOTICE_KINDS,
  PROCESS_RUN_STATUSES,
  type STAGE_RUN_STATUSES,
  type TEAM_RUN_STATUSES,
  TIMER_KINDS,
} from "@ai/contracts/chat";
import type { INPUT_TYPES } from "@ai/contracts/hub-admin";
import { DomainError, type ProcessDomainError } from "../domain/errors";
import * as limits from "../domain/limits";
import type {
  DecisionOption,
  DecisionReason,
  ExecutorKind,
  InputType,
  NoticeKind,
  ProcessRunStatus,
  StageRunStatus,
  TeamRunStatus,
  TimerKind,
} from "../domain/types";
import type { AssertEqual } from "./assert-equal";
import { DOMAIN_ERROR_MAP, domainErrorToApp, runStatusOf, timerKindOf } from "./processes.mapper";

const _types: [
  AssertEqual<ProcessRunStatus, (typeof PROCESS_RUN_STATUSES)[number]>,
  AssertEqual<StageRunStatus, (typeof STAGE_RUN_STATUSES)[number]>,
  AssertEqual<DecisionReason, (typeof DECISION_REASONS)[number]>,
  AssertEqual<DecisionOption, (typeof DECISION_OPTIONS)[number]>,
  AssertEqual<ExecutorKind, (typeof EXECUTOR_KINDS)[number]>,
  AssertEqual<TimerKind, (typeof TIMER_KINDS)[number]>,
  AssertEqual<InputType, (typeof INPUT_TYPES)[number]>,
  AssertEqual<NoticeKind, (typeof NOTICE_KINDS)[number]>,
  AssertEqual<TeamRunStatus, (typeof TEAM_RUN_STATUSES)[number]>,
] = [true, true, true, true, true, true, true, true, true];

describe("CA-R04 · union domain = mảng contract", () => {
  it("HUB-FR-143 · kiểu khớp lúc typecheck và giá trị DB thu hẹp đúng", () => {
    expect(_types.every(Boolean)).toBe(true);
    expect(PROCESS_RUN_STATUSES.map(runStatusOf)).toEqual([...PROCESS_RUN_STATUSES]);
    expect(TIMER_KINDS.map(timerKindOf)).toEqual([...TIMER_KINDS]);
  });
  it("HUB-FR-143 · chuỗi DB lạ ⇒ ném (không lọt union)", () => {
    expect(() => runStatusOf("paused")).toThrow("run status không hợp lệ: paused");
    expect(() => timerKindOf("cron")).toThrow("timer kind không hợp lệ: cron");
  });
});

describe("CA-R03 · domain/limits = hằng contract", () => {
  for (const [k, v] of Object.entries(limits)) {
    it(`HUB-FR-143 · limits.${k} = chat.${k}`, () => {
      const contract: unknown = (chat as Record<string, unknown>)[k];
      expect({ k, v: v as unknown }).toEqual({ k, v: contract });
    });
  }
});

describe("T7s · domain/runs/run-state.rules dùng trần domain = trần contract", () => {
  it("HUB-FR-143 · REDO_MAX/ASKS_MAX domain khớp contract (luật tính lần thử + hỏi lại)", () => {
    expect({ REDO_MAX: limits.REDO_MAX, ASKS_MAX: limits.ASKS_MAX }).toEqual({
      REDO_MAX: chat.REDO_MAX,
      ASKS_MAX: chat.ASKS_MAX,
    });
  });
});

describe("CONVENTIONS §5 · DOMAIN_ERROR_MAP ⇒ mã contract + HTTP", () => {
  const cases: [ProcessDomainError, string, number][] = [
    ["RUN_STATE", "PROCESS_RUN_STATE", 409],
    ["NO_OUTPUT", "NO_OUTPUT", 409],
    ["TIMER_STATE", "PROCESS_RUN_STATE", 409],
    ["REF_INVALID", "PROCESS_REF_INVALID", 422],
    ["DEF_INVALID", "PROCESS_DEF_INVALID", 422],
    ["TENANT_INVALID", "PROCESS_NOT_FOUND", 404],
  ];
  it("HUB-FR-143 · đủ mã, đúng code/status, giữ details", () => {
    expect(Object.keys(DOMAIN_ERROR_MAP).sort()).toEqual(cases.map(([c]) => c).sort());
    const got = cases.map(([c]) => {
      const e = domainErrorToApp(new DomainError(c, { path: "x" }));
      return [c, e.code, e.status, e.details];
    });
    expect(got).toEqual(cases.map(([c, code, status]) => [c, code, status, { path: "x" }]));
  });
});
