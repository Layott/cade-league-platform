import { describe, it, expect } from "vitest";
import {
  buildOrgCacPath,
  buildOrgContractPath,
  buildDisputeEvidencePath,
  buildAppealEvidencePath,
  PRIVATE_BUCKETS,
} from "./paths";

describe("storage path builders (Plan 13B)", () => {
  it("buildOrgCacPath → orgs/<orgId>/cac-cert.<ext>", () => {
    expect(buildOrgCacPath("ORG-1", "pdf")).toBe("orgs/ORG-1/cac-cert.pdf");
  });

  it("buildOrgContractPath → orgs/<orgId>/contracts/<contractId>.<ext>", () => {
    expect(buildOrgContractPath("ORG-1", "CON-1", "PDF")).toBe(
      "orgs/ORG-1/contracts/CON-1.pdf",
    );
  });

  it("buildDisputeEvidencePath → disputes/<disputeId>/<fileId>.<ext>", () => {
    expect(buildDisputeEvidencePath("D-1", "F-1", "png")).toBe(
      "disputes/D-1/F-1.png",
    );
  });

  it("buildAppealEvidencePath → appeals/<appealId>/<fileId>.<ext>", () => {
    expect(buildAppealEvidencePath("A-1", "F-9", "jpg")).toBe(
      "appeals/A-1/F-9.jpg",
    );
  });

  it("rejects bogus extensions", () => {
    expect(() => buildOrgCacPath("ORG-1", "../etc/passwd")).toThrow();
    expect(() => buildOrgCacPath("ORG-1", "")).toThrow();
  });

  it("exposes the four private buckets as a literal-typed array", () => {
    expect(PRIVATE_BUCKETS).toHaveLength(4);
    expect(PRIVATE_BUCKETS).toContain("org-cac-certs");
    expect(PRIVATE_BUCKETS).toContain("org-contracts");
    expect(PRIVATE_BUCKETS).toContain("dispute-evidence");
    expect(PRIVATE_BUCKETS).toContain("appeal-evidence");
  });
});
