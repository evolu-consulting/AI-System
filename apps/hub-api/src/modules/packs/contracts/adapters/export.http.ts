// Gap #8 · phản hồi tải tệp của `GET /contracts/export`: CSV (UTF-8 có BOM để Excel đọc đúng tiếng Việt) hoặc XLSX, đều dạng luồng.
import type { ExportResult } from "../application/export-contracts.usecase";
import {
  CSV_HEADER_LINE,
  csvLine,
  EXPORT_COLUMNS,
  type ExportCell,
  exportCells,
  exportFileName,
} from "../domain/export.rules";
import { xlsxStream } from "./xlsx-stream";

const BOM = "\uFEFF";
const CSV_BATCH = 2000;
const TYPES = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

function* cellRows(r: ExportResult): Generator<ExportCell[]> {
  let i = 0;
  for (const row of r.rows) yield exportCells(row, ++i, r.owners);
}

function csvStream(r: ExportResult): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const it = cellRows(r);
  let first = true;
  return new ReadableStream<Uint8Array>({
    pull(ctl) {
      let s = first ? BOM + CSV_HEADER_LINE : "";
      first = false;
      for (let k = 0; k < CSV_BATCH; k++) {
        const nx = it.next();
        if (nx.done) {
          ctl.enqueue(enc.encode(s));
          return ctl.close();
        }
        s += csvLine(nx.value, r.timeZone);
      }
      ctl.enqueue(enc.encode(s));
    },
  });
}

export function exportResponse(r: ExportResult, format: "xlsx" | "csv"): Response {
  const body =
    format === "csv"
      ? csvStream(r)
      : xlsxStream({
          sheet: "Hợp đồng",
          columns: EXPORT_COLUMNS,
          rows: cellRows(r),
          rowCount: r.rows.length,
          tz: r.timeZone,
        });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": TYPES[format],
      "content-disposition": `attachment; filename="${exportFileName(r.today, format)}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-export-total": String(r.total),
      "x-export-rows": String(r.rows.length),
      "x-export-truncated": r.truncated ? "1" : "0",
    },
  });
}
