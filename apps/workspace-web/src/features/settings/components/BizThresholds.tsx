// V2-L · CD-06: ngưỡng Mua thêm / Xả hàng / Đẩy mạnh / Cân nhắc dừng, bán sắp hết hạn của mục "Điểm kinh doanh".
import type { BizConfig } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Num, Panel, Row } from "./controls";

export function Thresholds({ v, set }: { v: BizConfig; set: (c: BizConfig) => void }) {
  const { t } = useTranslation();
  const s = (k: string) => t(`contracts.settings.biz.${k}`);
  const n = (k: keyof Omit<BizConfig, "w">, min: number, max: number, suffix: string) => (
    <Num
      id={`biz-${k}`}
      value={v[k]}
      min={min}
      max={max}
      suffix={suffix}
      onChange={(x) => set({ ...v, [k]: x })}
    />
  );
  const lbl = (k: string, text: string) => (
    <label htmlFor={`biz-${k}`} className="mb-1 block text-caption text-dim">
      {text}
    </label>
  );
  return (
    <Panel title={s("thresholds")}>
      <Row label={<span className="font-semibold text-ok">{s("buy")}</span>}>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            {lbl("buyDays", s("buyDays"))}
            {n("buyDays", 1, 365, s("days"))}
          </div>
          <div>
            {lbl("quotaBuy", s("quotaBuy"))}
            {n("quotaBuy", 50, 500, "%")}
          </div>
        </div>
      </Row>
      <Row label={<span className="font-semibold text-late">{s("dump")}</span>}>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            {lbl("dumpDays", s("dumpDays"))}
            {n("dumpDays", 30, 730, s("days"))}
          </div>
          <div>
            {lbl("quotaDump", s("quotaDump"))}
            {n("quotaDump", 10, 100, "%")}
          </div>
        </div>
      </Row>
      <Row label={s("free")}>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            {lbl("hi", s("hi"))}
            {n("hi", 50, 95, s("pts"))}
          </div>
          <div>
            {lbl("lo", s("lo"))}
            {n("lo", 10, 70, s("pts"))}
          </div>
        </div>
      </Row>
      <Row label={s("vol")} htmlFor="biz-vol">
        {n("vol", 1, 100000, s("orders"))}
      </Row>
      <Row label={s("soon")} htmlFor="biz-soon">
        {n("soon", 1, 365, s("days"))}
      </Row>
    </Panel>
  );
}
