"use client";

import { motion } from "framer-motion";
import { PreviewStub } from "../PreviewStub";
import { stingerNormalSchema } from "@/server/overlays/schemas";
import { STINGER_IN } from "@/lib/motion";

export const dynamic = "force-dynamic";

export default function StingerNormalPage() {
  return (
    <PreviewStub
      templateKey="stinger_normal"
      schema={stingerNormalSchema}
      position="fullscreen"
      render={(_p, { cycle }) => (
        <motion.div
          key={cycle}
          initial={{ clipPath: "inset(50% 0 50% 0)" }}
          animate={{ clipPath: "inset(0 0 0 0)" }}
          exit={{ clipPath: "inset(50% 0 50% 0)" }}
          transition={{ ...STINGER_IN }}
          style={{
            width: "100%",
            height: "100%",
            background: "var(--primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.1, opacity: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="font-broadcast-display"
            style={{
              fontSize: 200,
              color: "#000",
              letterSpacing: "-0.04em",
              fontWeight: 900,
            }}
          >
            CADE
          </motion.div>
        </motion.div>
      )}
    />
  );
}
