import Image from "next/image";

type Props = {
  photoUrl: string | null;
  displayName: string;
  size?: number;
  /** Optional jersey number to render as a ring badge over the avatar. */
  jerseyNumber?: number | null;
};

function initialsFrom(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/**
 * Circular player avatar. Uses a signal-green ring when a jersey number is
 * present, otherwise a neutral ink-5 border. Falls back to monogrammed
 * initials on a surface-ink tile.
 */
export function PlayerAvatar({
  photoUrl,
  displayName,
  size = 96,
  jerseyNumber,
}: Props) {
  const initials = initialsFrom(displayName);
  const hasJersey = jerseyNumber != null;
  const ring = hasJersey
    ? "ring-2 ring-[var(--signal)] shadow-[0_0_24px_-6px_var(--signal-glow)]"
    : "ring-1 ring-[var(--ink-5)]";

  return (
    <div
      className={"relative inline-flex items-center justify-center"}
      style={{ width: size, height: size }}
    >
      <div
        className={
          "relative flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[var(--ink-2)] " +
          ring
        }
      >
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={displayName}
            width={size}
            height={size}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            className="font-display font-bold text-[var(--chalk-0)]"
            style={{ fontSize: size / 2.8, letterSpacing: "-0.02em" }}
            aria-label={`${displayName} avatar`}
          >
            {initials}
          </span>
        )}
      </div>
      {hasJersey ? (
        <span
          className="absolute -bottom-1 -right-1 inline-flex min-w-[26px] items-center justify-center rounded-sm border border-[var(--signal)] bg-[var(--ink-0)] px-1.5 py-0.5 tabular text-[11px] font-bold text-[var(--signal)]"
          aria-hidden
        >
          {jerseyNumber}
        </span>
      ) : null}
    </div>
  );
}
