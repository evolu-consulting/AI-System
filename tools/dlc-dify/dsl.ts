// dlc-dify · dựng DSL app workflow Dify (0.7.0, Dify 1.18) bằng mã — một nguồn cho mọi flow hook + quy trình DLC.
// Node: start, http-request, code (python3), document-extractor, end, loop (+ loop-start, assigner v2 bên trong).
// Nối tuần tự: ở cấp ngoài theo thứ tự `nodes`; trong loop theo thứ tự `body`. Body JSON của HTTP luôn là MỘT biến do node
// code dựng bằng `json.dumps` (chữ người dùng có xuống dòng / dấu nháy không làm hỏng JSON). Xuất JSON (YAML ⊃ JSON).

export type StartVar = {
  name: string;
  label?: string;
  kind: "text-input" | "paragraph" | "file";
  required?: boolean;
  max?: number;
};
export type Ref = [node: string, variable: string];

type NodeData = Record<string, unknown> & { type: string; title: string };
export type Node = { id: string; data: NodeData; loop?: { body: Node[] } };

/** Biến chọn trong template Dify: `{{#node.var#}}`. */
export const ref = (node: string, v: string) => `{{#${node}.${v}#}}`;
export const env = (name: string) => `{{#env.${name}#}}`;

export function start(vars: readonly StartVar[]): Node {
  return {
    id: "start",
    data: {
      type: "start",
      title: "Start",
      desc: "",
      selected: false,
      variables: vars.map((v) =>
        v.kind === "file"
          ? {
              variable: v.name,
              label: v.label ?? v.name,
              type: "file",
              required: v.required ?? false,
              allowed_file_types: ["document"],
              allowed_file_upload_methods: ["local_file", "remote_url"],
              allowed_file_extensions: [],
            }
          : {
              variable: v.name,
              label: v.label ?? v.name,
              type: v.kind,
              required: v.required ?? false,
              max_length: v.max ?? (v.kind === "paragraph" ? 200_000 : 8_192),
              options: [],
            },
      ),
    },
  };
}

export type HttpSpec = {
  id: string;
  title: string;
  method: "get" | "post" | "put" | "patch";
  url: string;
  /** Mỗi dòng `Tên:giá trị` (template Dify được). */
  headers?: string[];
  /** Mỗi dòng `tên:giá trị`. */
  params?: string[];
  /** Biến chứa chuỗi JSON (do node code dựng). */
  jsonBody?: Ref;
  /** giây: connect / read / write. */
  timeout?: [number, number, number];
};

export function http(s: HttpSpec): Node {
  const [connect, read, write] = s.timeout ?? [30, 120, 120];
  return {
    id: s.id,
    data: {
      type: "http-request",
      title: s.title,
      desc: "",
      selected: false,
      method: s.method,
      url: s.url,
      authorization: { type: "no-auth", config: null },
      headers: (s.headers ?? []).join("\n"),
      params: (s.params ?? []).join("\n"),
      body: s.jsonBody
        ? { type: "json", data: [{ key: "", type: "text", value: ref(...s.jsonBody) }] }
        : { type: "none", data: [] },
      timeout: {
        connect,
        read,
        write,
        max_connect_timeout: connect,
        max_read_timeout: read,
        max_write_timeout: write,
      },
      ssl_verify: true,
      retry_config: {
        enabled: false,
        max_retries: 1,
        retry_interval: 1000,
        exponential_backoff: { enabled: false, multiplier: 2, max_interval: 10000 },
      },
    },
  };
}

export type CodeSpec = {
  id: string;
  title: string;
  /** `def main(<tên biến>...) -> dict:` — tên tham số = tên biến bên dưới. */
  code: string;
  inputs: Record<string, Ref>;
  outputs: string[];
};

export function code(s: CodeSpec): Node {
  return {
    id: s.id,
    data: {
      type: "code",
      title: s.title,
      desc: "",
      selected: false,
      code_language: "python3",
      code: s.code,
      variables: Object.entries(s.inputs).map(([variable, sel]) => ({
        variable,
        value_selector: sel,
      })),
      outputs: Object.fromEntries(s.outputs.map((o) => [o, { type: "string", children: null }])),
    },
  };
}

/** Trích chữ từ file (pdf, md, docx…); không có file ⇒ `text` rỗng (mảng rỗng), không lỗi. */
export function extractor(id: string, title: string, file: Ref): Node {
  return {
    id,
    data: {
      type: "document-extractor",
      title,
      desc: "",
      selected: false,
      variable_selector: file,
      is_array_file: false,
    },
  };
}

/** Gán biến loop từ đầu ra node trong loop (assigner v2, ghi đè). */
export function assign(id: string, loopId: string, sets: Record<string, Ref>): Node {
  return {
    id,
    data: {
      type: "assigner",
      title: "Cập nhật biến vòng",
      desc: "",
      selected: false,
      version: "2",
      items: Object.entries(sets).map(([v, sel]) => ({
        variable_selector: [loopId, v],
        input_type: "variable",
        operation: "over-write",
        value: sel,
        write_mode: "over-write",
      })),
    },
  };
}

/** Loop: lặp `body` tới khi biến `breakOn.var` == `breakOn.value` (hoặc hết `max` vòng). Biến loop là chuỗi. */
export function loop(s: {
  id: string;
  title: string;
  vars: Record<string, string>;
  breakOn: { var: string; value: string };
  max: number;
  body: Node[];
}): Node {
  return {
    id: s.id,
    loop: { body: s.body },
    data: {
      type: "loop",
      title: s.title,
      desc: "",
      selected: false,
      start_node_id: `${s.id}start`,
      loop_count: s.max,
      logical_operator: "and",
      break_conditions: [
        {
          id: crypto.randomUUID(),
          comparison_operator: "is",
          value: s.breakOn.value,
          varType: "string",
          variable_selector: [s.id, s.breakOn.var],
        },
      ],
      loop_variables: Object.entries(s.vars).map(([label, value]) => ({
        id: crypto.randomUUID(),
        label,
        value,
        value_type: "constant",
        var_type: "string",
      })),
      width: 1200,
      height: 300,
    },
  };
}

export function end(outputs: Record<string, Ref>): Node {
  return {
    id: "end",
    data: {
      type: "end",
      title: "End",
      desc: "",
      selected: false,
      outputs: Object.entries(outputs).map(([variable, sel]) => ({
        variable,
        value_selector: sel,
        value_type: "string",
      })),
    },
  };
}

export type AppSpec = {
  name: string;
  description: string;
  envVars: Record<string, string>;
  nodes: Node[];
};

type Edge = Record<string, unknown>;
const edge = (
  a: { id: string; type: string },
  b: { id: string; type: string },
  loopId?: string,
): Edge => ({
  id: `${a.id}-source-${b.id}-target`,
  source: a.id,
  sourceHandle: "source",
  target: b.id,
  targetHandle: "target",
  type: "custom",
  zIndex: loopId ? 1002 : 0,
  data: {
    sourceType: a.type,
    targetType: b.type,
    isInIteration: false,
    isInLoop: !!loopId,
    ...(loopId ? { loop_id: loopId } : {}),
  },
});

/** App workflow: node nối tuần tự theo thứ tự `nodes`; loop có node con nối từ `<loop>start`. */
export function app(s: AppSpec): Record<string, unknown> {
  const nodes: Record<string, unknown>[] = [];
  const edges: Edge[] = [];
  s.nodes.forEach((n, i) => {
    nodes.push({
      id: n.id,
      type: "custom",
      position: { x: 80 + i * 320, y: 280 },
      positionAbsolute: { x: 80 + i * 320, y: 280 },
      width: n.loop ? 1200 : 244,
      height: n.loop ? 300 : 90,
      selected: false,
      sourcePosition: "right",
      targetPosition: "left",
      ...(n.loop ? { zIndex: 1 } : {}),
      data: n.data,
    });
    const prev = s.nodes[i - 1];
    if (prev)
      edges.push(edge({ id: prev.id, type: prev.data.type }, { id: n.id, type: n.data.type }));
    if (!n.loop) return;
    const startId = `${n.id}start`;
    nodes.push({
      id: startId,
      type: "custom-loop-start",
      parentId: n.id,
      draggable: false,
      selectable: false,
      position: { x: 24, y: 68 },
      positionAbsolute: { x: 104 + i * 320, y: 348 },
      width: 44,
      height: 48,
      zIndex: 1002,
      sourcePosition: "right",
      targetPosition: "left",
      data: { type: "loop-start", title: "", desc: "", selected: false, isInLoop: true },
    });
    let last = { id: startId, type: "loop-start" };
    n.loop.body.forEach((c, k) => {
      nodes.push({
        id: c.id,
        type: "custom",
        parentId: n.id,
        position: { x: 120 + k * 280, y: 60 },
        positionAbsolute: { x: 200 + i * 320 + k * 280, y: 340 },
        width: 244,
        height: 90,
        zIndex: 1002,
        selected: false,
        sourcePosition: "right",
        targetPosition: "left",
        data: { ...c.data, isInLoop: true, isInIteration: false, loop_id: n.id },
      });
      edges.push(edge(last, { id: c.id, type: c.data.type }, n.id));
      last = { id: c.id, type: c.data.type };
    });
  });
  return {
    app: {
      name: s.name,
      mode: "workflow",
      description: s.description,
      icon: "🤖",
      icon_background: "#E4FBCC",
      use_icon_as_answer_icon: false,
    },
    kind: "app",
    version: "0.7.0",
    dependencies: [],
    workflow: {
      conversation_variables: [],
      environment_variables: Object.entries(s.envVars).map(([name, value]) => ({
        id: crypto.randomUUID(),
        name,
        value,
        value_type: "string",
        description: "",
        selector: ["env", name],
      })),
      features: {},
      graph: { nodes, edges, viewport: { x: 0, y: 0, zoom: 0.5 } },
    },
  };
}

/** Đầu vào cho catalog Admin: biến `file` ⇒ input `file` (Hub upload file của job lên Dify); còn lại `text`. */
export function catalogInputs(vars: readonly StartVar[]) {
  return vars.map((v) => ({
    name: v.name,
    type: v.kind === "file" ? ("file" as const) : ("text" as const),
    required: v.required ?? false,
    description: v.label ?? v.name,
  }));
}
