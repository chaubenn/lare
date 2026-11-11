import { cn } from "../cn";

/**
 * Where a profile picture may load from: the OAuth providers' avatar hosts (GitHub, Google) and,
 * once the app registers it, its own Supabase storage. `avatar_url` is free text its owner can
 * set, so any other address would let them see who looked at their picture, and when.
 */
const avatarOrigins = new Set([
  "https://avatars.githubusercontent.com",
  "https://lh3.googleusercontent.com",
  "https://lh4.googleusercontent.com",
  "https://lh5.googleusercontent.com",
  "https://lh6.googleusercontent.com",
]);

/** Also accept avatars from `origin` (the app's Supabase project, where uploads go). */
export function allowAvatarOrigin(origin: string): void {
  try {
    avatarOrigins.add(new URL(origin).origin);
  } catch {
    // not a URL: nothing to allow
  }
}

function avatarSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return avatarOrigins.has(parsed.origin) ? parsed.href : null;
  } catch {
    return null;
  }
}

export function Avatar({
  url,
  name,
  size = 32,
  className,
}: {
  url: string | null | undefined;
  name: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) };
  const src = avatarSrc(url);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={style}
        className={cn("shrink-0 rounded-full bg-[var(--surface-sunken)] object-cover", className)}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] font-semibold text-[var(--text-secondary)]",
        className,
      )}
    >
      {initial}
    </span>
  );
}
