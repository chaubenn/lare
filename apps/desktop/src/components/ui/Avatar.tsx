import { cn } from "@lare/ui";

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
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        style={style}
        className={cn("shrink-0 rounded-full bg-zinc-800 object-cover", className)}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-800 font-semibold text-zinc-300",
        className,
      )}
    >
      {initial}
    </span>
  );
}
