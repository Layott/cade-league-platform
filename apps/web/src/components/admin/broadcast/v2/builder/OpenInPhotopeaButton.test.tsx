/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OpenInPhotopeaButton } from "./OpenInPhotopeaButton";

describe("OpenInPhotopeaButton", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED;
  });

  it("renders a link to /psd?assetId=<id> when flag is on and asset is a psd", () => {
    render(
      <OpenInPhotopeaButton
        designSlug="my-design"
        assetId="11111111-1111-4111-8111-111111111111"
        assetType="psd"
        photopeaEnabled={true}
      />,
    );
    const link = screen.getByRole("link", { name: /open in photopea/i });
    expect(link.getAttribute("href")).toBe(
      "/admin/broadcast/v2/builder/my-design/psd?assetId=11111111-1111-4111-8111-111111111111",
    );
  });

  it("renders nothing when assetType is not psd", () => {
    const { container } = render(
      <OpenInPhotopeaButton
        designSlug="my-design"
        assetId="11111111-1111-4111-8111-111111111111"
        assetType="image"
        photopeaEnabled={true}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when photopeaEnabled is false", () => {
    const { container } = render(
      <OpenInPhotopeaButton
        designSlug="my-design"
        assetId="11111111-1111-4111-8111-111111111111"
        assetType="psd"
        photopeaEnabled={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
