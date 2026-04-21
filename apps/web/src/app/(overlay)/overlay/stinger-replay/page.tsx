"use client";

import { motion } from "framer-motion";
import { PreviewStub } from "../PreviewStub";
import { stingerReplaySchema } from "@/server/overlays/schemas";
import { STINGER_IN } from "@/lib/motion";

export const dynamic = "force-dynamic";

export default function StingerReplayPage() {
  return (
    <PreviewStub
      templateKey="stinger_replay"
      schema={stingerReplaySchema}
      position="fullscreen"
      render={(_p, { cycle }) => (
        <motion.div
          key={cycle}
          initial={{ x: "100%" }}
          animate={{ x: "0%" }}
          exit={{ x: "-100%" }}
          transition={{ ...STINGER_IN }}
          style={{
            width: "100%",
            height: "100%",
            background:
              "linear-gradient(135deg, var(--secondary) 0%, var(--ink-0) 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <motion.div
            initial={{ opacity: 0, letterSpacing: "0.6em" }}
            animate={{ opacity: 1, letterSpacing: "0.15em" }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="font-broadcast-display"
            style={{
              fontSize: 160,
              color: "#fff",
              fontWeight: 900,
              textTransform: "uppercase",
            }}
          >
            REPLAY
          </motion.div>
        </motion.div>
      )}
    />
  );
}
