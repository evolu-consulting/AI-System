// PK-FR-07 · ADR-0024: đọc XML OOXML bằng `saxes` (SAX, chỉ 5 entity chuẩn ⇒ không XXE/billion laughs; entity lạ ⇒ lỗi) thành
// mô hình khối của `domain/docx.rules.ts`. Giới hạn độ sâu (DOCX_MAX_DEPTH) và lượng chữ gom (DOCX_MAX_MD). Lỗi XML ⇒ ném.
import { SaxesParser, type SaxesTagPlain } from "saxes";
import {
  addWarning,
  DOCX_MAX_DEPTH,
  DOCX_MAX_MD,
  type DocxBlock,
  type DocxNumbering,
  type DocxPara,
  type DocxStyle,
  emptyNumbering,
} from "../../domain/docx.rules";

type Attrs = Record<string, string>;
type Handlers = {
  open(name: string, a: Attrs): void;
  close(name: string): void;
  text?(t: string): void;
};

/** Chạy saxes (không namespace — tên giữ tiền tố `w:`), chặn độ sâu, lỗi ⇒ ném. */
export function parseXml(xml: string, h: Handlers): void {
  const p = new SaxesParser({ xmlns: false, position: false });
  let depth = 0;
  p.on("error", (e) => {
    throw e;
  });
  p.on("opentag", (tag: SaxesTagPlain) => {
    if (++depth > DOCX_MAX_DEPTH) throw new Error("XML too deep");
    h.open(tag.name, tag.attributes);
  });
  // saxes gọi closetag cả cho thẻ tự đóng.
  p.on("closetag", (tag) => {
    depth--;
    h.close(tag.name);
  });
  if (h.text) p.on("text", h.text);
  p.write(xml).close();
}

const isOn = (a: Attrs) => !/^(0|false|off)$/i.test(a["w:val"] ?? "true");

type Cell = { texts: string[]; span: number };
type TableState = { rows: string[][]; row: string[]; cell: Cell | null };

/** Trạng thái đọc document.xml. */
class DocumentReader {
  blocks: DocxBlock[] = [];
  warnings: string[] = [];
  private para: DocxPara | null = null;
  private nestedP = 0;
  private tables: TableState[] = [];
  private nestedTbl = 0;
  private skip = 0;
  private inPPr = false;
  private inRun = false;
  private bold = false;
  private inT = false;
  private chars = 0;

  open = (name: string, a: Attrs): void => {
    if (this.skip) return void this.skip++;
    switch (name) {
      case "mc:Fallback":
        this.skip = 1;
        return;
      case "w:p":
        if (this.para) {
          this.nestedP++;
          addWarning(this.warnings, "textbox");
        } else this.para = { kind: "p", runs: [], ilvl: 0 };
        return;
      case "w:pPr":
        this.inPPr = true;
        return;
      case "w:r":
        this.inRun = true;
        this.bold = false;
        return;
      case "w:t":
        this.inT = true;
        return;
      case "w:tab":
        if (this.inRun) this.addText(" ");
        return;
      case "w:br":
      case "w:cr":
        if (this.inRun && a["w:type"] !== "page") this.addText("\n");
        return;
    }
    this.openProps(name, a);
  };

  private openProps(name: string, a: Attrs): void {
    const p = this.para;
    if (name === "w:b" && this.inRun && !this.inPPr) this.bold = isOn(a);
    else if (p && this.inPPr && !this.nestedP) this.paraProp(p, name, a);
    else this.openTable(name, a);
  }

  private paraProp(p: DocxPara, name: string, a: Attrs): void {
    const v = a["w:val"];
    if (v === undefined) return;
    if (name === "w:pStyle") p.styleId = v;
    else if (name === "w:outlineLvl") p.outline = Number(v);
    else if (name === "w:numId") p.numId = v;
    else if (name === "w:ilvl") p.ilvl = Number(v) || 0;
  }

  private openTable(name: string, a: Attrs): void {
    const t = this.tables.at(-1);
    if (name === "w:tbl") {
      if (t) {
        this.nestedTbl++;
        addWarning(this.warnings, "nested_table");
      } else this.tables.push({ rows: [], row: [], cell: null });
    } else if (!t || this.nestedTbl) return;
    else if (name === "w:tr") t.row = [];
    else if (name === "w:tc") t.cell = { texts: [], span: 1 };
    else if (name === "w:gridSpan" && t.cell) {
      t.cell.span = Math.min(Math.max(Number(a["w:val"]) || 1, 1), 64);
      if (t.cell.span > 1) addWarning(this.warnings, "merged_cells");
    } else if (name === "w:vMerge") addWarning(this.warnings, "merged_cells");
  }

  close = (name: string): void => {
    if (this.skip) return void this.skip--;
    if (name === "w:t") this.inT = false;
    else if (name === "w:r") this.inRun = false;
    else if (name === "w:pPr") this.inPPr = false;
    else if (name === "w:p") this.closePara();
    else this.closeTable(name);
  };

  private closePara(): void {
    if (this.nestedP) return void this.nestedP--;
    const p = this.para;
    this.para = null;
    if (!p) return;
    const cell = this.tables.at(-1)?.cell;
    if (cell) cell.texts.push(p.runs.map((r) => r.text).join(""));
    else this.blocks.push(p);
  }

  private closeTable(name: string): void {
    const t = this.tables.at(-1);
    if (!t) return;
    if (name === "w:tbl") {
      if (this.nestedTbl) return void this.nestedTbl--;
      this.tables.pop();
      this.blocks.push({ kind: "table", rows: t.rows });
    } else if (this.nestedTbl) return;
    else if (name === "w:tc" && t.cell) {
      t.row.push(t.cell.texts.join(" "), ...Array(t.cell.span - 1).fill(""));
      t.cell = null;
    } else if (name === "w:tr") t.rows.push(t.row);
  }

  text = (s: string): void => {
    if (this.inT && this.para && !this.skip) this.addText(s);
  };

  private addText(s: string): void {
    const p = this.para;
    if (!p || this.chars > DOCX_MAX_MD) return;
    this.chars += s.length;
    if (this.chars > DOCX_MAX_MD) addWarning(this.warnings, "truncated");
    const last = p.runs.at(-1);
    if (last && last.bold === this.bold) last.text += s;
    else p.runs.push({ text: s, bold: this.bold });
  }
}

/** document.xml → khối + cảnh báo. */
export function readDocument(xml: string): { blocks: DocxBlock[]; warnings: string[] } {
  const r = new DocumentReader();
  parseXml(xml, r);
  return { blocks: r.blocks, warnings: r.warnings };
}

/** styles.xml → styleId → {name, basedOn, outline}. */
export function readStyles(xml: string): Map<string, DocxStyle> {
  const styles = new Map<string, DocxStyle>();
  let cur: DocxStyle | null = null;
  parseXml(xml, {
    open(name, a) {
      const v = a["w:val"];
      if (name === "w:style") {
        cur = {};
        if (a["w:styleId"]) styles.set(a["w:styleId"], cur);
      } else if (!cur || v === undefined) return;
      else if (name === "w:name") cur.name = v;
      else if (name === "w:basedOn") cur.basedOn = v;
      else if (name === "w:outlineLvl") cur.outline = Number(v);
    },
    close(name) {
      if (name === "w:style") cur = null;
    },
  });
  return styles;
}

/** numbering.xml → numId → abstractNumId, abstractNumId → ilvl → numFmt. */
export function readNumbering(xml: string): DocxNumbering {
  const n = emptyNumbering();
  let abs: Map<number, string> | null = null;
  let lvl = 0;
  let numId: string | null = null;
  const on: Record<string, (a: Attrs) => void> = {
    "w:abstractNum": (a) => {
      abs = new Map();
      n.formats.set(a["w:abstractNumId"] ?? "", abs);
    },
    "w:lvl": (a) => {
      lvl = Number(a["w:ilvl"]) || 0;
    },
    "w:numFmt": (a) => abs?.set(lvl, a["w:val"] ?? "bullet"),
    "w:num": (a) => {
      numId = a["w:numId"] ?? null;
    },
    "w:abstractNumId": (a) => numId !== null && n.nums.set(numId, a["w:val"] ?? ""),
  };
  parseXml(xml, {
    open(name, a) {
      on[name]?.(a);
    },
    close(name) {
      if (name === "w:abstractNum") abs = null;
      else if (name === "w:num") numId = null;
    },
  });
  return n;
}
