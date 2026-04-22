/**
 * Plan 13B + Plan 31 — Storage path builders.
 *
 * Conventions (spec §3.1):
 *   org-cac-certs    → `orgs/{orgId}/cac-cert.{ext}`        (deprecated, Plan 31)
 *   org-contracts    → `orgs/{orgId}/contracts/{contractId}.{ext}`
 *   dispute-evidence → `disputes/{disputeId}/{fileId}.{ext}`
 *   appeal-evidence  → `appeals/{appealId}/{fileId}.{ext}`
 *   org-logos (Plan 31, public) → `orgs/{orgId}/logo.{ext}`
 */

export const ORG_CAC_BUCKET = "org-cac-certs" as const;
export const ORG_CONTRACTS_BUCKET = "org-contracts" as const;
export const DISPUTE_EVIDENCE_BUCKET = "dispute-evidence" as const;
export const APPEAL_EVIDENCE_BUCKET = "appeal-evidence" as const;
// Plan 31 — public bucket for org logos. Read via CDN, write via signed upload.
export const ORG_LOGOS_BUCKET = "org-logos" as const;

export type PrivateBucket =
  | typeof ORG_CAC_BUCKET
  | typeof ORG_CONTRACTS_BUCKET
  | typeof DISPUTE_EVIDENCE_BUCKET
  | typeof APPEAL_EVIDENCE_BUCKET;

export const PRIVATE_BUCKETS: readonly PrivateBucket[] = [
  ORG_CAC_BUCKET,
  ORG_CONTRACTS_BUCKET,
  DISPUTE_EVIDENCE_BUCKET,
  APPEAL_EVIDENCE_BUCKET,
];

function sanitizeExt(ext: string): string {
  const clean = ext.replace(/^\.+/, "").toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(clean)) {
    throw new Error(`invalid file extension: ${ext}`);
  }
  return clean;
}

export function buildOrgCacPath(orgId: string, ext: string): string {
  return `orgs/${orgId}/cac-cert.${sanitizeExt(ext)}`;
}

export function buildOrgContractPath(
  orgId: string,
  contractId: string,
  ext: string,
): string {
  return `orgs/${orgId}/contracts/${contractId}.${sanitizeExt(ext)}`;
}

export function buildDisputeEvidencePath(
  disputeId: string,
  fileId: string,
  ext: string,
): string {
  return `disputes/${disputeId}/${fileId}.${sanitizeExt(ext)}`;
}

export function buildAppealEvidencePath(
  appealId: string,
  fileId: string,
  ext: string,
): string {
  return `appeals/${appealId}/${fileId}.${sanitizeExt(ext)}`;
}

/**
 * Plan 31 — public org logo path. Mirrors the CAC-cert convention so
 * we can later soft-archive the CAC bucket without disturbing logo
 * lookups.
 */
export function buildOrgLogoPath(orgId: string, ext: string): string {
  return `orgs/${orgId}/logo.${sanitizeExt(ext)}`;
}
