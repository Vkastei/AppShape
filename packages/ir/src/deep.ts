export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Structural equality. Object keys holding `undefined` count as absent. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Applies a shallow patch: `null` removes a key, `undefined` leaves it, anything else replaces it.
 * Returns `undefined` when the result has no keys.
 */
export function applyPatch<T extends object>(
  target: T | undefined,
  patch: { [key: string]: unknown },
): T | undefined {
  const result: Record<string, unknown> = { ...(target ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete result[key];
    else result[key] = clone(value);
  }
  return Object.keys(result).length > 0 ? (result as T) : undefined;
}

/** The shallow patch that turns `a` into `b`, or `undefined` when they are equal. */
export function diffObject(
  a: object | undefined,
  b: object | undefined,
): Record<string, unknown> | undefined {
  const left = (a ?? {}) as Record<string, unknown>;
  const right = (b ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (deepEqual(left[key], right[key])) continue;
    patch[key] = right[key] === undefined ? null : clone(right[key]);
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}
