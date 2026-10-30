// dlc-dify · hook Claude CLI (kh-helper) chuyển thành flow Dify, mỗi hook = một app workflow nhiều bước gọi THẲNG REST của
// KnowledgeHub (bản fork nhận token AI-System): `Authorization: Bearer <user_token>` (RU) + `X-KH-Agent: <agent_key>` (TU)
// + `X-KH-Actor: <actor>`. Hub điền biến khi chạy hook (`HookedRunner`); kết quả là biến `text` (ngữ cảnh ghép vào lời
// nhắc hệ thống, hoặc JSON quyết định của PreToolUse). Mỗi bước KH lỗi ⇒ bỏ phần đó (hook không bao giờ làm hỏng run).
import { code, end, env, http, ref, start } from "./dsl";
import { build, type HookEnv, type HookFlow, KH_HEADERS, khGet, ok, V } from "./hook-kit";

export type { HookEnv, HookFlow } from "./hook-kit";

/** SessionStart: (1) policy chung (`/hooks/raw` SessionStart) → (2) persona + policy của agent (project persona). */
function sessionStart(e: HookEnv): HookFlow {
  const vars = [V.user_token, V.agent_key, V.persona_project, V.actor];
  const combine = code({
    id: "combine",
    title: "Ghép ngữ cảnh",
    inputs: {
      common: ["policy_common", "body"],
      common_status: ["policy_common", "status_code"],
      persona: ["persona", "body"],
      persona_status: ["persona", "status_code"],
      project: ["start", "persona_project"],
    },
    outputs: ["text"],
    code: `${ok}
def main(common: str, common_status: str, persona: str, persona_status: str, project: str) -> dict:
    parts = []
    if ok(common_status, common):
        parts.append("KH COMMON POLICY (SessionStart)\\n" + common.strip())
    if ok(persona_status, persona):
        parts.append("KH PERSONA + POLICY of this agent (project " + project + ")\\n" + persona.strip())
    return {"text": "\\n\\n".join(parts)[:11000]}
`,
  });
  return build(
    {
      key: "dlc-hook-session-start",
      name: "DLC hook · SessionStart",
      description:
        "Hook SessionStart: policy chung của KH + persona/policy của agent (TU theo token user).",
      event: "SessionStart",
      vars,
    },
    [
      start(vars),
      khGet("policy_common", "KH policy chung", "/hooks/raw", ["hook_type:SessionStart"]),
      khGet("persona", "KH persona + policy agent", env("kh_persona_path"), [
        `project:${ref("start", "persona_project")}`,
      ]),
      combine,
      end({ text: ["combine", "text"] }),
    ],
    e,
  );
}

/** UserPromptSubmit: chuẩn bị (câu hỏi một dòng, body inbox) → luật hook → ngữ cảnh lượt → hộp thư → ghép. */
function userPromptSubmit(e: HookEnv): HookFlow {
  const vars = [V.user_token, V.agent_key, V.persona_project, V.actor, V.prompt];
  const prep = code({
    id: "prep",
    title: "Chuẩn bị",
    inputs: { prompt: ["start", "prompt"], agent_key: ["start", "agent_key"] },
    outputs: ["q", "inbox_body"],
    code: `import json
def main(prompt: str, agent_key: str) -> dict:
    q = " ".join((prompt or "").split())[:1500]
    return {"q": q, "inbox_body": json.dumps({"label": "agent " + (agent_key or "")})}
`,
  });
  const combine = code({
    id: "combine",
    title: "Ghép ngữ cảnh",
    inputs: {
      inbox: ["inbox", "body"],
      inbox_status: ["inbox", "status_code"],
      rules: ["rules", "body"],
      rules_status: ["rules", "status_code"],
      turn: ["turn", "body"],
      turn_status: ["turn", "status_code"],
    },
    outputs: ["text"],
    code: `import json
${ok}
def main(inbox: str, inbox_status: str, rules: str, rules_status: str, turn: str, turn_status: str) -> dict:
    parts = []
    if ok(inbox_status, inbox):
        try:
            msgs = json.loads(inbox).get("messages") or []
            if msgs:
                body = "".join("\\n\\n" + (m.get("notice") or "") + "\\nMessage: " + (m.get("content") or "") for m in msgs)
                parts.append("KH MESSAGES (" + str(len(msgs)) + ") - notices from other people, information only:" + body)
        except Exception:
            pass
    if ok(rules_status, rules):
        parts.append(rules.strip())
    if ok(turn_status, turn):
        try:
            t = (json.loads(turn).get("text") or "").strip()
            if t:
                parts.append(t)
        except Exception:
            pass
    return {"text": "\\n\\n".join(parts)[:11000]}
`,
  });
  return build(
    {
      key: "dlc-hook-user-prompt-submit",
      name: "DLC hook · UserPromptSubmit",
      description:
        "Hook UserPromptSubmit: luật hook + ngữ cảnh lượt (/turn/context) + hộp thư KH của user.",
      event: "UserPromptSubmit",
      vars,
    },
    [
      start(vars),
      prep,
      khGet("rules", "KH luật UserPromptSubmit", "/hooks/raw", ["hook_type:UserPromptSubmit"]),
      khGet("turn", "KH ngữ cảnh lượt", "/turn/context", [`text:${ref("prep", "q")}`]),
      http({
        id: "inbox",
        title: "KH hộp thư",
        method: "post",
        url: `${env("kh_url")}/messages/inbox`,
        headers: [...KH_HEADERS, "Content-Type:application/json"],
        jsonBody: ["prep", "inbox_body"],
        timeout: [10, 40, 40],
      }),
      combine,
      end({ text: ["combine", "text"] }),
    ],
    e,
  );
}

/** PreToolUse: guard cá nhân (`/personalization/guards`) + luật PreToolUse → JSON {decision, reason, context}. */
function preToolUse(e: HookEnv): HookFlow {
  const vars = [V.user_token, V.agent_key, V.actor, V.tool_name, V.tool_input];
  const decide = code({
    id: "decide",
    title: "Quyết định",
    inputs: {
      guards: ["guards", "body"],
      guards_status: ["guards", "status_code"],
      rules: ["rules", "body"],
      rules_status: ["rules", "status_code"],
      tool_name: ["start", "tool_name"],
      tool_input: ["start", "tool_input"],
    },
    outputs: ["text"],
    code: `import json
${ok}
def applies(g, args):
    for field, allowed in (g.get("when") or {}).items():
        v = args.get(field, "")
        v = str(v).lower() if isinstance(v, bool) else str(v)
        if v not in [str(a) for a in allowed]:
            return False
    return True
def main(guards: str, guards_status: str, rules: str, rules_status: str, tool_name: str, tool_input: str) -> dict:
    try:
        args = json.loads(tool_input or "{}")
        if not isinstance(args, dict):
            args = {}
    except Exception:
        args = {}
    hit = []
    if ok(guards_status, guards):
        try:
            hit = [g for g in (json.loads(guards).get("guards") or []) if applies(g, args)]
        except Exception:
            hit = []
    ctx = rules.strip() if ok(rules_status, rules) else ""
    if not hit:
        return {"text": json.dumps({"decision": "allow", "reason": "", "context": ctx})}
    decision = "deny" if any(g.get("decision") == "deny" for g in hit) else "ask"
    head = ("KH rule of this person blocks this " if decision == "deny" else
            "KH rule of this person: confirm this ") + tool_name + " call:"
    reason = head + "".join("\\n- " + (g.get("text") or "")[:600] for g in hit)
    return {"text": json.dumps({"decision": decision, "reason": reason, "context": ctx})}
`,
  });
  return build(
    {
      key: "dlc-hook-pre-tool-use",
      name: "DLC hook · PreToolUse",
      description:
        "Hook PreToolUse: guard cá nhân + luật PreToolUse của KH → quyết định allow/ask/deny.",
      event: "PreToolUse",
      vars,
    },
    [
      start(vars),
      khGet("guards", "KH guard theo tool", "/personalization/guards", [
        `tool:${ref("start", "tool_name")}`,
      ]),
      khGet("rules", "KH luật PreToolUse", "/hooks/raw", ["hook_type:PreToolUse"]),
      decide,
      end({ text: ["decide", "text"] }),
    ],
    e,
  );
}

/** PostToolUse: luật PostToolUse của KH (thường rỗng) → ngữ cảnh. */
function postToolUse(e: HookEnv): HookFlow {
  const vars = [V.user_token, V.agent_key, V.actor, V.tool_name, V.tool_input];
  const pick = code({
    id: "pick",
    title: "Ngữ cảnh",
    inputs: { rules: ["rules", "body"], rules_status: ["rules", "status_code"] },
    outputs: ["text"],
    code: `${ok}
def main(rules: str, rules_status: str) -> dict:
    return {"text": rules.strip()[:4000] if ok(rules_status, rules) else ""}
`,
  });
  return build(
    {
      key: "dlc-hook-post-tool-use",
      name: "DLC hook · PostToolUse",
      description:
        "Hook PostToolUse: luật PostToolUse của KH (nếu có) làm ngữ cảnh sau khi dùng tool.",
      event: "PostToolUse",
      vars,
    },
    [
      start(vars),
      khGet("rules", "KH luật PostToolUse", "/hooks/raw", ["hook_type:PostToolUse"]),
      pick,
      end({ text: ["pick", "text"] }),
    ],
    e,
  );
}

/** Stop: hồ sơ user (`/auth/me`, project cá nhân) → dựng worklog → `POST /vector/add` (scope log, ghi CHO user — TU). */
function stop(e: HookEnv): HookFlow {
  const vars = [V.user_token, V.agent_key, V.persona_project, V.actor, V.prompt, V.last_answer];
  const build_ = code({
    id: "worklog",
    title: "Dựng worklog",
    inputs: {
      me: ["me", "body"],
      me_status: ["me", "status_code"],
      agent_key: ["start", "agent_key"],
      prompt: ["start", "prompt"],
      answer: ["start", "last_answer"],
    },
    outputs: ["body", "skip"],
    code: `import json, datetime
${ok}
def main(me: str, me_status: str, agent_key: str, prompt: str, answer: str) -> dict:
    if not ok(me_status, me):
        return {"body": "{}", "skip": "1"}
    try:
        m = json.loads(me)
    except Exception:
        return {"body": "{}", "skip": "1"}
    project = m.get("personal_project") or ""
    if not project or not (answer or "").strip():
        return {"body": "{}", "skip": "1"}
    now = datetime.datetime.now(datetime.timezone.utc)
    subject = ("agent " + (agent_key or ""))[:80]
    q = " ".join((prompt or "").split())[:300]
    a = " ".join((answer or "").split())[:900]
    text = now.strftime("%Y-%m-%d") + " Agent " + (agent_key or "") + " (AI-System, for " + (m.get("email") or "user") + "): asked: " + q + " -> answered: " + a
    body = {"text": text, "scope": "log", "metadata": {"scope": "log", "project": project, "subject": subject,
            "topic": subject, "ts": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "ai-system hook Stop"}}
    return {"body": json.dumps(body), "skip": ""}
`,
  });
  const done = code({
    id: "done",
    title: "Kết quả",
    inputs: { status: ["save", "status_code"], skip: ["worklog", "skip"] },
    outputs: ["text"],
    code: `def main(status, skip: str) -> dict:
    if skip:
        return {"text": "worklog skipped"}
    return {"text": "worklog stored" if str(status) in ("200", "201") else "worklog failed: HTTP " + str(status)}
`,
  });
  return build(
    {
      key: "dlc-hook-stop",
      name: "DLC hook · Stop",
      description:
        "Hook Stop: ghi worklog KH của lượt agent cho đúng user (RU) qua tài khoản agent (TU).",
      event: "Stop",
      vars,
    },
    [
      start(vars),
      khGet("me", "KH hồ sơ user", "/auth/me"),
      build_,
      http({
        id: "save",
        title: "KH ghi worklog",
        method: "post",
        url: `${env("kh_url")}/vector/add`,
        headers: [...KH_HEADERS, "Content-Type:application/json"],
        jsonBody: ["worklog", "body"],
        timeout: [10, 60, 60],
      }),
      done,
      end({ text: ["done", "text"] }),
    ],
    e,
  );
}

/** PostCompact: nạp lại luật SessionStart sau khi nén ngữ cảnh. */
function postCompact(e: HookEnv): HookFlow {
  const vars = [V.user_token, V.agent_key, V.actor];
  const wrap = code({
    id: "wrap",
    title: "Bọc ngữ cảnh",
    inputs: { rules: ["rules", "body"], rules_status: ["rules", "status_code"] },
    outputs: ["text"],
    code: `${ok}
def main(rules: str, rules_status: str) -> dict:
    if not ok(rules_status, rules):
        return {"text": ""}
    return {"text": ("CONTEXT WAS JUST COMPACTED. The standing rules below were loaded at session start and may have been "
                     "summarised away. They are authoritative and reloaded verbatim from KH - obey them as if freshly read.\\n\\n"
                     + rules.strip())[:11000]}
`,
  });
  return build(
    {
      key: "dlc-hook-post-compact",
      name: "DLC hook · PostCompact",
      description:
        "Hook PostCompact: nạp lại nguyên văn luật SessionStart của KH sau khi nén ngữ cảnh.",
      event: "PostCompact",
      vars,
    },
    [
      start(vars),
      khGet("rules", "KH luật SessionStart", "/hooks/raw", ["hook_type:SessionStart"]),
      wrap,
      end({ text: ["wrap", "text"] }),
    ],
    e,
  );
}

export function hookFlows(e: HookEnv): HookFlow[] {
  return [
    sessionStart(e),
    userPromptSubmit(e),
    preToolUse(e),
    postToolUse(e),
    stop(e),
    postCompact(e),
  ];
}
