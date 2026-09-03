import Image from "next/image";
import { cn } from "@/lib/cn";

const SIZES = {
  sm: { px: 28, className: "size-7 text-[11px]" },
  md: { px: 40, className: "size-10 text-sm" },
  lg: { px: 80, className: "size-20 text-2xl" },
} as const;

export function Avatar({
  src,
  name,
  size = "md",
  className,
}: {
  src: string | null | undefined;
  name: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { px, className: sizeClass } = SIZES[size];
  const label = name?.trim() || "?";
  const initial = label.replace(/^@/, "").charAt(0).toUpperCase();

  if (src) {
    return (
      <Image
        src={src}
        alt={label}
        width={px}
        height={px}
        unoptimized
        referrerPolicy="no-referrer"
        className={cn("shrink-0 rounded-full bg-zinc-800 object-cover", sizeClass, className)}
      />
    );
  }
  return (
    <span
      aria-label={label}
      role="img"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-800 font-semibold text-zinc-300",
        sizeClass,
        className,
      )}
    >
      {initial}
    </span>
  );
}
