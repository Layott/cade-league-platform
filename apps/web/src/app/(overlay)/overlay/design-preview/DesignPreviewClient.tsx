"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import {
  sendPreviewMessage,
  encodePayloadForPreview,
} from "@/lib/overlay-preview";

type Card = {
  key: string;
  route: string;
  label: string;
  defaultSoundSlot: string | null;
};

type Group = {
  group: string;
  label: string;
  templates: Card[];
};

type FrameSize = "1080p" | "1440p" | "4k";
const FRAME_SIZES: Record<FrameSize, { w: number; h: number }> = {
  "1080p": { w: 1920, h: 1080 },
  "1440p": { w: 2560, h: 1440 },
  "4k": { w: 3840, h: 2160 },
};

type Background = "black" | "checker" | "transparent";

const SAMPLE_PAYLOAD: Record<string, unknown> = {
  stinger_intro: {
    seasonLabel: "Elite · 2025-26",
    matchDayLabel: "Match Day 1",
    soundSlot: "stinger-intro",
  },
  stinger_normal: { soundSlot: "stinger-normal" },
  stinger_replay: { soundSlot: "stinger-replay" },
  stinger_goal: {
    scorerDisplayName: "ADEFOLA",
    soundSlot: "stinger-goal",
  },
  stinger_winner: {
    winnerDisplayName: "ADEFOLA",
    finalScore: { home: 3, away: 1 },
    soundSlot: "stinger-winner",
  },
  layout_4pip: {
    cells: [
      { displayName: "ADEFOLA" },
      { displayName: "ANIFE" },
      { displayName: "BAJI_JNR" },
      { displayName: "DADABOI" },
    ],
  },
  layout_2pip: {
    cells: [{ displayName: "ADEFOLA" }, { displayName: "KILLER_FREAK" }],
  },
  layout_brb_full: {
    resumeAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  },
  layout_brb_basic: { message: "BE RIGHT BACK" },
  layout_timer: { expiresAt: new Date(Date.now() + 60 * 1000).toISOString() },
  layout_animated_bg: { intensity: "medium" },
  layout_casters_chat: {
    chat: [
      { user: "DAPO", msg: "GG WP" },
      { user: "ZED", msg: "what a goal" },
    ],
    ticker: "ELITE DIV 1 · MD1 · LIVE",
  },
  h2h_2: {
    players: [
      { displayName: "ADEFOLA", h2hStats: { w: 3, d: 1, l: 0 } },
      { displayName: "KILLER_FREAK", h2hStats: { w: 0, d: 1, l: 3 } },
    ],
    soundSlot: "whoosh-long",
  },
  h2h_3: {
    players: [
      { displayName: "ADEFOLA" },
      { displayName: "ANIFE" },
      { displayName: "MITCH" },
    ],
  },
  h2h_5: {
    players: [
      { displayName: "ADEFOLA" },
      { displayName: "ANIFE" },
      { displayName: "MITCH" },
      { displayName: "KAYKAY" },
      { displayName: "GURU" },
    ],
  },
  leaderboard_animated: {
    topN: 5,
    rows: [
      { rank: 1, displayName: "ADEFOLA", pts: 12, gd: 8 },
      { rank: 2, displayName: "MITCH", pts: 10, gd: 5 },
      { rank: 3, displayName: "ANIFE", pts: 9, gd: 3 },
      { rank: 4, displayName: "KAYKAY", pts: 7, gd: 1 },
      { rank: 5, displayName: "GURU", pts: 6, gd: -1 },
    ],
  },
  score_bug: {
    players: [
      { displayName: "ADEFOLA", score: 2 },
      { displayName: "KILLER_FREAK", score: 1 },
    ],
  },
  up_next_bug: {
    home: { displayName: "ADEFOLA" },
    away: { displayName: "KILLER_FREAK" },
    kickoffAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  },
  match_scores_day: {
    matchDayLabel: "MD 1",
    rows: [
      { home: "ADEFOLA", away: "ANIFE", homeScore: 3, awayScore: 1, status: "completed" },
      { home: "MITCH", away: "KAYKAY", homeScore: 2, awayScore: 2, status: "completed" },
      { home: "GURU", away: "FARUK", homeScore: null, awayScore: null, status: "in_progress" },
    ],
  },
  starting_soon_basic: { subtitle: "Match Day 1 begins shortly" },
  starting_soon_timer: {
    startsAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  },
  stream_ended: {
    subtitle: "Thanks for watching",
    socials: { twitter: "@cade_league", instagram: "@cade_league" },
  },
  top_scorers: {
    rows: [
      { rank: 1, displayName: "ADEFOLA", goals: 14 },
      { rank: 2, displayName: "MITCH", goals: 11 },
      { rank: 3, displayName: "ANIFE", goals: 9 },
    ],
  },
  orgs_roster: {
    org: { name: "CADE ESPORTS" },
    players: [
      { displayName: "ADEFOLA" },
      { displayName: "ANIFE" },
      { displayName: "MITCH" },
    ],
  },
  coach_intros: {
    coach: { displayName: "Coach K" },
    players: [{ displayName: "ADEFOLA" }, { displayName: "ANIFE" }],
  },
  player_penalties: {
    rows: [
      { displayName: "BAJI_JNR", count: 3, sanctionType: "fine" },
      { displayName: "KINGNONEX", count: 2, sanctionType: "suspension" },
    ],
  },
  // Legacy payloads retained for preview coverage.
  scorebar: { homeName: "ADEFOLA", awayName: "KILLER_FREAK", homeScore: 2, awayScore: 1 },
  lower_third: {
    playerId: "11111111-1111-4111-8111-111111111111",
    displayName: "ADEFOLA",
    gamerTag: "ADEFOLA_10",
    jerseyNumber: 10,
    stats: { gp: 4, w: 3, d: 1, l: 0, pts: 10 },
  },
  standings_widget: {
    topN: 3,
    rows: [
      { rank: 1, displayName: "ADEFOLA", pts: 12, gd: 8 },
      { rank: 2, displayName: "MITCH", pts: 10, gd: 5 },
      { rank: 3, displayName: "ANIFE", pts: 9, gd: 3 },
    ],
  },
  player_card: {
    playerId: "11111111-1111-4111-8111-111111111111",
    displayName: "ADEFOLA",
    gamerTag: "ADEFOLA_10",
    seasonStats: { gp: 4, w: 3, d: 1, l: 0, gf: 12, ga: 4, pts: 10 },
  },
  punishment_ticker: {
    items: [
      {
        playerName: "BAJI_JNR",
        sanction: "fine",
        magnitude: "-5000",
        issuedAt: "2026-04-20",
      },
    ],
  },
  intro: { matchDayLabel: "MD 1", seasonLabel: "Elite 25/26" },
  outro: { matchDayLabel: "MD 1" },
  // Plan 44 — featured YouTube chat comment
  featured_comment: {
    authorName: "Sample Viewer",
    message: "What a goal! Keep it up CADE!!!",
    postedAt: "2026-04-22T00:00:00.000Z",
    displaySeconds: 10,
    slot: "primary",
  },
};

export function DesignPreviewClient({ groups }: { groups: Group[] }) {
  const [frame, setFrame] = useState<FrameSize>("1080p");
  const [background, setBackground] = useState<Background>("black");
  const [speed, setSpeed] = useState<number>(1);
  const [sound, setSound] = useState<boolean>(false);

  useEffect(() => {
    // Persist header choices.
    try {
      const raw = window.localStorage.getItem("overlay-design-preview");
      if (raw) {
        const v = JSON.parse(raw) as Partial<{
          frame: FrameSize;
          background: Background;
          speed: number;
          sound: boolean;
        }>;
        if (v.frame) setFrame(v.frame);
        if (v.background) setBackground(v.background);
        if (typeof v.speed === "number") setSpeed(v.speed);
        if (typeof v.sound === "boolean") setSound(v.sound);
      }
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "overlay-design-preview",
        JSON.stringify({ frame, background, speed, sound }),
      );
      window.localStorage.setItem(
        "overlay-sound-muted",
        sound ? "0" : "1",
      );
    } catch {
      /* noop */
    }
  }, [frame, background, speed, sound]);

  const totalTemplates = useMemo(
    () => groups.reduce((acc, g) => acc + g.templates.length, 0),
    [groups],
  );

  return (
    <div
      data-testid="design-preview-root"
      style={{
        minHeight: "100vh",
        padding: "32px 32px 80px",
        background: "var(--ink-0)",
        color: "var(--chalk-0)",
        fontFamily: "var(--font-body)",
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 24,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            className="font-broadcast-display"
            style={{ fontSize: 40, margin: 0, color: "var(--primary)" }}
          >
            Overlay Design Preview
          </h1>
          <p style={{ margin: "4px 0 0", color: "var(--chalk-2)" }}>
            {totalTemplates} templates · Plan 16 review harness
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <ControlBlock label="Frame">
            {(["1080p", "1440p", "4k"] as FrameSize[]).map((f) => (
              <PillButton
                key={f}
                active={frame === f}
                onClick={() => setFrame(f)}
              >
                {f}
              </PillButton>
            ))}
          </ControlBlock>
          <ControlBlock label="Background">
            {(["black", "checker", "transparent"] as Background[]).map((b) => (
              <PillButton
                key={b}
                active={background === b}
                onClick={() => setBackground(b)}
              >
                {b}
              </PillButton>
            ))}
          </ControlBlock>
          <ControlBlock label="Speed">
            {[0.25, 0.5, 1, 2].map((s) => (
              <PillButton
                key={s}
                active={speed === s}
                onClick={() => setSpeed(s)}
              >
                {s}x
              </PillButton>
            ))}
          </ControlBlock>
          <ControlBlock label="Sound">
            <PillButton active={sound} onClick={() => setSound((v) => !v)}>
              {sound ? "on" : "off"}
            </PillButton>
          </ControlBlock>
        </div>
      </header>

      {groups.map((g) => (
        <section key={g.group} style={{ marginBottom: 48 }}>
          <h2
            className="font-broadcast-accent"
            style={{
              fontSize: 14,
              letterSpacing: "0.3em",
              color: "var(--primary)",
              borderBottom: "1px solid var(--ink-4)",
              paddingBottom: 8,
              marginBottom: 16,
            }}
          >
            {g.label}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
              gap: 24,
            }}
          >
            {g.templates.map((t) => (
              <TemplateCard
                key={t.key}
                card={t}
                frame={frame}
                background={background}
                speed={speed}
                sound={sound}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TemplateCard({
  card,
  frame,
  background,
  speed,
  sound,
}: {
  card: Card;
  frame: FrameSize;
  background: Background;
  speed: number;
  sound: boolean;
}) {
  const size = FRAME_SIZES[frame];
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const initialPayload = useMemo(
    () => SAMPLE_PAYLOAD[card.key] ?? {},
    [card.key],
  );
  const [payloadJson, setPayloadJson] = useState<string>(() =>
    JSON.stringify(initialPayload, null, 2),
  );
  const [ver, setVer] = useState<number>(1);
  const [jsonValid, setJsonValid] = useState<boolean>(true);

  const encoded = useMemo(() => {
    try {
      const obj = JSON.parse(payloadJson);
      return encodePayloadForPreview(obj);
    } catch {
      return encodePayloadForPreview(initialPayload);
    }
  }, [payloadJson, initialPayload]);

  const src = `${card.route}?preview=1&payload=${encoded}&ver=${ver}${
    sound ? "" : "&mute=1"
  }`;

  // Post --motion-speed via CSS var write inside the iframe after load.
  useEffect(() => {
    const frameEl = iframeRef.current;
    if (!frameEl) return;
    try {
      const doc = frameEl.contentDocument;
      if (doc?.documentElement) {
        doc.documentElement.style.setProperty("--motion-speed", String(speed));
      }
    } catch {
      /* cross-origin — ignored */
    }
  }, [speed, ver]);

  const scale = 0.2;
  const bg =
    background === "black"
      ? "#000"
      : background === "checker"
        ? "repeating-conic-gradient(#161616 0 25%, #0b0b0b 0 50%) 0 0 / 40px 40px"
        : "transparent";

  return (
    <div
      data-testid="template-card"
      data-template-key={card.key}
      style={{
        border: "1px solid var(--ink-4)",
        background: "var(--ink-1)",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <header
        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <div>
          <div
            className="font-broadcast-display"
            style={{ fontSize: 20, color: "var(--chalk-0)" }}
          >
            {card.label}
          </div>
          <div
            className="tabular"
            style={{ color: "var(--chalk-3)", fontSize: 12 }}
          >
            {card.key} · {card.defaultSoundSlot ?? "silent"}
          </div>
        </div>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          title="Open this template full-screen in a new tab with the same payload, auto-looping. Use browser fullscreen (F11) for a true 1920×1080 preview."
          style={{
            fontSize: 11,
            color: "var(--primary)",
            textDecoration: "underline",
          }}
        >
          open ⤢
        </a>
      </header>

      <div
        style={{
          position: "relative",
          width: "100%",
          paddingTop: `${(size.h / size.w) * 100}%`,
          background: bg,
          overflow: "hidden",
          borderRadius: 4,
          border: "1px solid var(--ink-3)",
        }}
      >
        <iframe
          ref={iframeRef}
          data-testid="template-iframe"
          src={src}
          title={card.label}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: size.w,
            height: size.h,
            border: 0,
            transformOrigin: "top left",
            transform: `scale(${scale})`,
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <MiniButton
          onClick={() => {
            setVer((n) => n + 1);
            sendPreviewMessage(iframeRef.current, {
              type: "overlay-preview.animate-in",
            });
          }}
        >
          Replay
        </MiniButton>
        <MiniButton
          onClick={() =>
            sendPreviewMessage(iframeRef.current, { type: "overlay-preview.exit" })
          }
        >
          Exit
        </MiniButton>
        <MiniButton
          onClick={() => {
            try {
              setPayloadJson(JSON.stringify(initialPayload, null, 2));
            } catch {
              /* noop */
            }
          }}
        >
          Reset
        </MiniButton>
      </div>

      <textarea
        value={payloadJson}
        onChange={(e) => {
          setPayloadJson(e.target.value);
          try {
            JSON.parse(e.target.value);
            setJsonValid(true);
          } catch {
            setJsonValid(false);
          }
        }}
        onBlur={() => {
          if (jsonValid) setVer((n) => n + 1);
        }}
        spellCheck={false}
        className="tabular"
        style={{
          resize: "vertical",
          width: "100%",
          minHeight: 80,
          background: "var(--ink-2)",
          color: jsonValid ? "var(--chalk-0)" : "var(--flare)",
          border: "1px solid var(--ink-4)",
          fontSize: 11,
          padding: 8,
          borderRadius: 4,
        }}
      />
    </div>
  );
}

function ControlBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        className="font-broadcast-accent"
        style={{ fontSize: 10, color: "var(--chalk-3)" }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: 4 }}>{children}</div>
    </div>
  );
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 12px",
        fontSize: 12,
        borderRadius: 3,
        background: active ? "var(--primary)" : "var(--ink-2)",
        color: active ? "var(--primary-ink)" : "var(--chalk-1)",
        border: "1px solid var(--ink-4)",
        cursor: "pointer",
        textTransform: "lowercase",
      }}
    >
      {children}
    </button>
  );
}

function MiniButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 10px",
        background: "var(--ink-2)",
        color: "var(--chalk-1)",
        border: "1px solid var(--ink-4)",
        borderRadius: 3,
        fontSize: 11,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
