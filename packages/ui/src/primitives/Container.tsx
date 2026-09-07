import type { HTMLAttributes } from "react";
import { cn } from "../cn";

const WIDTHS = {
  prose: "max-w-xl",
  page: "max-w-3xl",
  wide: "max-w-6xl",
} as const;

export function Container({
  width = "page",
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { width?: keyof typeof WIDTHS }) {
  return <div className={cn("mx-auto w-full px-4 sm:px-6", WIDTHS[width], className)} {...rest} />;
}
