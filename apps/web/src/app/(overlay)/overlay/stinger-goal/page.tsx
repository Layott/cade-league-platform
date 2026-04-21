"use client";

import { motion } from "framer-motion";
import { PreviewStub } from "../PreviewStub";
import { stingerGoalSchema } from "@/server/overlays/schemas";
import { SCORE_FLIP, STINGER_IN } from "@/lib/motion";

export const dynamic = "force-dynamic";

export default function StingerGoalPage() {
  return (
    <PreviewStub
      templateKey="stinger_goal"
      schema={stingerGoalSchema}
      position="fullscreen"
      render={(p, { cycle }) => (
        <motion.div
          key={cycle}
          style={{
            width: "100%",
            height: "100%",
            background: "var(--primary)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {[...Array(8)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ x: i % 2 === 0 ? "-100vw" : "100vw" }}
              animate={{ x: "0vw" }}
              transition={{ delay: i * 0.04, ...STINGER_IN }}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: `${i * 12.5}%`,
                height: 1,
                background: "#000",
                opacity: 0.1,
              }}
            />
          ))}
          <motion.div
            initial={{ scale: 0, rotate: -8 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 1.2, opacity: 0 }}
            transition={{ ...SCORE_FLIP }}
            className="font-broadcast-display"
            style={{
              fontSize: 260,
              color: "#000",
              letterSpacing: "-0.05em",
              fontWeight: 900,
              lineHeight: 0.9,
              zIndex: 1,
            }}
          >
            GOAL
          </motion.div>
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="font-broadcast-accent"
            style={{
              fontSize: 48,
              color: "#000",
              textTransform: "uppercase",
              letterSpacing: "0.3em",
              marginTop: 8,
              zIndex: 1,
            }}
          >
            {p.scorerDisplayName ?? "SCORER"}
          </motion.div>
        </motion.div>
      )}
    />
  );
}
