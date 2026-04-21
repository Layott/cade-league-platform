"use client";

import { PreviewStub } from "../PreviewStub";
import { layoutAnimatedBgSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function LayoutAnimatedBgPage() {
  return (
    <PreviewStub
      templateKey="layout_animated_bg"
      schema={layoutAnimatedBgSchema}
      position="center"
      render={() => (
        <div
          style={{
            width: "100vw",
            height: "100vh",
            background:
              "radial-gradient(1200px 800px at 20% 30%, var(--primary-glow), transparent 60%), radial-gradient(1000px 600px at 80% 70%, var(--secondary-glow), transparent 60%), var(--ink-0)",
          }}
        />
      )}
    />
  );
}
