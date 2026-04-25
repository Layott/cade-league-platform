"use client";

import { useCallback, useState } from "react";
import { SecondaryButton } from "@/components/admin/buttons";

/**
 * Plan 51 — copies the session view_token to the clipboard. The token is
 * the session-scoped shared secret browser sources read off the URL
 * (`?token=...`).
 */
export function CopyTokenButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      window.prompt("Copy view token:", token);
    }
  }, [token]);

  return (
    <SecondaryButton
      type="button"
      onClick={onClick}
      data-testid="v2-copy-token"
      aria-label="Copy session view token"
    >
      {copied ? "Token copied" : "Copy view token"}
    </SecondaryButton>
  );
}
