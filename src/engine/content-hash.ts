export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("内容哈希不支持非有限数值");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalizeJson(item)).join(",") + "]";
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return "{" + keys.map((key) => JSON.stringify(key) + ":" + canonicalizeJson(object[key])).join(",") + "}";
  }
  throw new Error("内容哈希遇到不支持的数据类型");
}

export async function sha256Json(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前浏览器缺少 WebCrypto，无法安全校验剧情内容版本");
  }
  const bytes = new TextEncoder().encode(canonicalizeJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return "sha256:" + hex;
}
