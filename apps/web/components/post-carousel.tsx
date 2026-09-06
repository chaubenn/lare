"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Children, type ReactNode, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Instagram-style swipe deck. Native scroll-snap does the swiping (so touch, trackpad and
 * keyboard all work without a gesture library); the arrows and dots are for pointer users.
 */
export function PostCarousel({
  children,
  label = "Post media",
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const slides = Children.toArray(children);
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  function goTo(next: number) {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(slides.length - 1, next));
    track.scrollTo({ left: clamped * track.clientWidth, behavior: "smooth" });
    setIndex(clamped);
  }

  function onScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const next = Math.round(track.scrollLeft / track.clientWidth);
    if (next !== index) setIndex(next);
  }

  if (slides.length === 0) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={label}
      className={cn(
        "relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950",
        className,
      )}
    >
      <div
        ref={trackRef}
        onScroll={onScroll}
        // 4:3 on phones so the breakdown slide has room; the 1200x630 cover letterboxes into it.
        className="flex aspect-[4/3] snap-x snap-mandatory sm:aspect-[1200/630] overflow-x-auto overflow-y-hidden scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, i) => (
          // biome-ignore lint/a11y/useSemanticElements: the ARIA carousel pattern wants role="group" on a slide, not a fieldset.
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: slides are a fixed, ordered deck.
            key={i}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${slides.length}`}
            className="w-full shrink-0 snap-center snap-always"
          >
            {slide}
          </div>
        ))}
      </div>

      {slides.length > 1 && (
        <>
          <NavButton
            side="left"
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
            label="Previous slide"
          />
          <NavButton
            side="right"
            disabled={index === slides.length - 1}
            onClick={() => goTo(index + 1)}
            label="Next slide"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {slides.map((_, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: slides are a fixed, ordered deck.
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index}
                className={cn(
                  "pointer-events-auto size-1.5 rounded-full transition-colors",
                  i === index ? "bg-zinc-100" : "bg-zinc-100/35 hover:bg-zinc-100/60",
                )}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function NavButton({
  side,
  disabled,
  onClick,
  label,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "absolute top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-zinc-950/60 p-1.5 text-zinc-100 ring-1 ring-white/10 backdrop-blur transition-opacity hover:bg-zinc-950/80 disabled:pointer-events-none disabled:opacity-0 sm:block",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      {side === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  );
}
