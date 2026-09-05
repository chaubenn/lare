import type { CSSProperties } from "react";
import { cn } from "../cn";
import emblemUrl from "./emblem.png";

function resolveSrc(mod: string | { src: string }): string {
  return typeof mod === "string" ? mod : mod.src;
}

const EMBLEM = resolveSrc(emblemUrl);

const MASK: CSSProperties = {
  WebkitMaskImage: `url(${EMBLEM})`,
  maskImage: `url(${EMBLEM})`,
  WebkitMaskSize: "contain",
  maskSize: "contain",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  maskPosition: "center",
};

export function Emblem({ className, title }: { className?: string; title?: string }) {
  if (title) {
    return (
      <span
        role="img"
        aria-label={title}
        className={cn("inline-block bg-current", className)}
        style={MASK}
      />
    );
  }
  return <span aria-hidden className={cn("inline-block bg-current", className)} style={MASK} />;
}

export function Wordmark({
  className,
  markClassName,
  label = "Lare",
}: {
  className?: string;
  markClassName?: string;
  label?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Emblem className={cn("size-7", markClassName)} />
      <span className="font-medium tracking-tight">{label}</span>
    </span>
  );
}
