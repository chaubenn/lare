import { cn } from "@lare/ui";
import { ChevronLeft, ChevronRight } from "@lare/ui/icons";
import { Children, type ReactNode, useRef, useState } from "react";

/**
 * Instagram-style swipe deck. The card has one fixed size, a 16:9 frame (with a floor and a cap),
 * whichever slide is showing. A slide that has more than fits, such as an expanded review, scrolls
 * inside its own slide instead of growing the card and pushing the page down. The dots sit below
 * the card, not over it, so they never cover a video's controls.
 *
 * The height comes from the card's width via container units, not `aspect-ratio`: a minimum height
 * on an aspect-ratio box widens it, and in a narrow column the card then clips the slide's text.
 *
 * Native scroll-snap does the swiping (so touch, trackpad and keyboard all work without a gesture
 * library); the arrows and dots are for pointer users.
 * Ported from the web feed so both apps render the identical carousel.
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
      className={cn("relative", className)}
    >
      <div className="relative">
        <div className="@container relative overflow-hidden rounded-xl border border-zinc-800 bg-[var(--surface-raised)]">
          <div
            ref={trackRef}
            onScroll={onScroll}
            className="flex h-[clamp(22rem,56.25cqw,75vh)] snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {slides.map((slide, i) => (
              // biome-ignore lint/a11y/useSemanticElements: the ARIA carousel pattern wants role="group" on a slide, not a fieldset.
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: slides are a fixed, ordered deck.
                key={i}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${slides.length}`}
                className="flex h-full w-full shrink-0 snap-center snap-always flex-col overflow-y-auto overflow-x-hidden overscroll-contain [&>*]:my-auto"
              >
                {slide}
              </div>
            ))}
          </div>
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
          </>
        )}
      </div>

      {slides.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5">
          {slides.map((_, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: slides are a fixed, ordered deck.
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === index}
              className={cn(
                "size-1.5 rounded-full transition-colors",
                i === index
                  ? "bg-[var(--text)]"
                  : "bg-[color-mix(in_oklab,var(--text-tertiary)_50%,transparent)] hover:bg-[var(--text-tertiary)]",
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Arrows sit outside the media frame (in the card's padding) so they never cover the slide
 * content — a video fills the frame edge to edge.
 */
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
        side === "left" ? "-left-3 sm:-left-4" : "-right-3 sm:-right-4",
      )}
    >
      {side === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  );
}
