import Image from "next/image";

type Props = {
  photoUrl: string | null;
  displayName: string;
  size?: number;
};

export function PlayerAvatar({ photoUrl, displayName, size = 96 }: Props) {
  if (photoUrl) {
    return (
      <Image
        src={photoUrl}
        alt={displayName}
        width={size}
        height={size}
        className="rounded-lg object-cover bg-slate-100"
      />
    );
  }

  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-lg bg-slate-200 flex items-center justify-center text-slate-600 font-semibold"
      aria-label={`${displayName} avatar placeholder`}
    >
      <span style={{ fontSize: size / 3 }}>{initials || "?"}</span>
    </div>
  );
}
