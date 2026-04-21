"use client";

import { motion } from "framer-motion";
import { PreviewStub } from "../PreviewStub";
import { stingerIntroSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function StingerIntroPage() {
  return (
    <PreviewStub
      templateKey="stinger_intro"
      schema={stingerIntroSchema}
      position="fullscreen"
      render={(p, { cycle }) => (
        <motion.div
          key={cycle}
          style={{
            width: "100%",
            height: "100%",
            background: "var(--ink-0)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.5, 1.2], opacity: [0, 0.25, 0.15] }}
            transition={{ duration: 1.2, times: [0, 0.5, 1] }}
            style={{
              position: "absolute",
              width: 1200,
              height: 1200,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, var(--primary) 0%, transparent 70%)",
            }}
          />
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="font-broadcast-accent"
            style={{
              fontSize: 32,
              color: "var(--primary)",
              textTransform: "uppercase",
              letterSpacing: "0.3em",
              zIndex: 1,
            }}
          >
            {p.matchDayLabel ?? "Match Day"}
          </motion.div>
          <motion.div
            initial={{ clipPath: "inset(0 100% 0 0)" }}
            animate={{ clipPath: "inset(0 0% 0 0)" }}
            transition={{ delay: 0.5, duration: 0.8, ease: [0.85, 0, 0.15, 1] }}
            className="font-broadcast-display"
            style={{
              fontSize: 220,
              color: "var(--primary)",
              lineHeight: 1,
              letterSpacing: "-0.04em",
              fontWeight: 900,
              zIndex: 1,
            }}
          >
            CADE
          </motion.div>
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 1.0, duration: 0.5 }}
            className="font-broadcast-accent"
            style={{
              fontSize: 20,
              color: "#fff",
              textTransform: "uppercase",
              letterSpacing: "0.4em",
              marginTop: 8,
              zIndex: 1,
            }}
          >
            {p.seasonLabel ?? "Elite · 2025-26"}
          </motion.div>
        </motion.div>
      )}
    />
  );
}
