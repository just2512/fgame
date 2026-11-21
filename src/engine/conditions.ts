import type { Condition, GameState } from "./types";

function readPath(state: GameState, path: string): unknown {
  const parts = path.split(".");
  let cursor: unknown = state;

  for (const part of parts) {
    if (cursor === null || typeof cursor !== "object" || !Object.prototype.hasOwnProperty.call(cursor, part)) {
      throw new Error("Unknown condition path: " + path);
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }

  return cursor;
}

function compare(actual: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "contains":
      if (Array.isArray(actual)) return actual.includes(expected);
      if (typeof actual === "string" && typeof expected === "string") return actual.includes(expected);
      return false;
    default:
      throw new Error("Unsupported condition operator: " + op);
  }
}

export function evaluateCondition(condition: Condition | undefined, state: GameState): boolean {
  if (!condition) return true;
  if ("all" in condition) return condition.all.every((item) => evaluateCondition(item, state));
  if ("any" in condition) return condition.any.some((item) => evaluateCondition(item, state));
  if ("not" in condition) return !evaluateCondition(condition.not, state);
  const actual = readPath(state, condition.path);
  return compare(actual, condition.op, condition.value);
}
