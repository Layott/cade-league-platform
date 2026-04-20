import { createHash } from "node:crypto";

type Input = { userAgent: string; ip: string; acceptLanguage: string };

function ipPrefix(ip: string): string {
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.0.0`;
  return ip;
}

export function deviceFingerprint(input: Input): string {
  const normalized = [
    input.userAgent.trim(),
    ipPrefix(input.ip.trim()),
    input.acceptLanguage.split(",")[0]?.trim() ?? "",
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex");
}
