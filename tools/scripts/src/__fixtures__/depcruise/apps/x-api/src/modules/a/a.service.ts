// Fixture cố ý vi phạm T-DEP-2: module a import repo của module b.
import { findB } from "../b/b.repo";

export const serviceA = () => findB();
