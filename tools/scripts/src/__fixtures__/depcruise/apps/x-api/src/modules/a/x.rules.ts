// Fixture cố ý vi phạm T-DEP-3: rules import module core của Bun.
import { Database } from "bun:sqlite";

export const canX = (): boolean => typeof Database === "function";
