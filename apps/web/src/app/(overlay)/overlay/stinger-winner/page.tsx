"use client";

import { motion } from "framer-motion";
import { PreviewStub } from "../PreviewStub";
import { stingerWinnerSchema } from "@/server/overlays/schemas";
import { SCORE_FLIP } from "@/lib/motion";

export const dynamic = "force-dynamic";

export default function StingerWinnerPage() {
  return (
    <PreviewStub
      templateKey="stinger_winner"
      schema={stingerWinnerSchema}
      position="fullscreen"
      render={(p, { cycle }) => (
        <motion.div
          key={cycle}
          style={{
            width: "100%",
            height: "100%",
            background:
              "radial-gradient(circle at center, var(--primary) 0%, var(--ink-0) 70%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="font-broadcast-accent"
            style={{
              fontSize: 40,
              color: "#000",
              textTransform: "uppercase",
              letterSpacing: "0.4em",
            }}
          >
            Winner
          </motion.div>
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.05, opacity: 0 }}
            transition={{ ...SCORE_FLIP, delay: 0.3 }}
            className="font-broadcast-display"
            style={{
              fontSize: 180,
              color: "#000",
              letterSpacing: "-0.02em",
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            {p.winnerDisplayName ?? "CHAMPION"}
          </motion.div>
          {p.finalScore ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.4 }}
              className="font-broadcast-accent tabular"
              style={{
                fontSize: 80,
                color: "#000",
                marginTop: 12,
                letterSpacing: "0.15em",
                fontWeight: 700,
              }}
            >
              {p.finalScore.home} - {p.finalScore.away}
            </motion.div>
          ) : null}
        </motion.div>
      )}
    />
  );
}
