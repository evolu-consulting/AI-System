// V2-J1 · ADR-0023: cổng repo điểm kinh doanh (lớp 2 — chỉ kiểu); `adapters/business.repo.ts` cài.

import type { BizContractOut, BizLotOut, BizSaleOut } from "../domain/business.types";
import type { BizInput } from "../domain/business-score.rules";

export type BizRow = {
  id: string;
  name: string;
  unit: string | null;
  input: BizInput;
  value: number;
  expiresOn: string | null;
  revenueAll: number;
};
export type StoredBiz = { config: unknown; version: number; updated_at: string } | null;
export type BizFilter = { id?: string; group?: string; q?: string };
export type BizExtras = {
  lots: BizLotOut[];
  sales: BizSaleOut[];
  contracts_count: number;
};

export type BusinessRepo = {
  config(): Promise<StoredBiz>;
  saveConfig(cfg: unknown): Promise<NonNullable<StoredBiz>>;
  rows(today: string, f: BizFilter): Promise<BizRow[]>;
  extras(id: string, today: string): Promise<BizExtras>;
  contractsOf(id: string): Promise<BizContractOut[]>;
  exists(id: string): Promise<boolean>;
};
