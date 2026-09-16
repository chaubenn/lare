import { cn } from "@lare/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Children, type ReactNode, useLayoutEffect, useRef, useState } from "react";

/**
 * Instagram-style swipe deck. Native scroll-snap does the swiping (so touch, trackpad and
 * keyboard all work without a gesture library); the arrows and dots are for pointer users.
 * Ported from the web feed so both apps render the identical carousel.
 */
export function PostCarousel({
  children,
  label = "Post media",
  className,
  fitActiveSlide = false,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  /**
   * Size the frame to whatever the current slide needs instead of holding one
   * aspect ratio. The feed wants the fixed frame — every card the same shape —
   * but a deck carrying text wants the text to simply fit.
   */
  fitActiveSlide?: boolean;
}) {
  const slides = Children.toArray(children);
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [index, setIndex] = useState(0);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!fitActiveSlide) return;
    const el = slideRefs.current[index];
    if (!el) return;
    // Content inside a slide changes height on its own — "Show code", the problem
    // description collapsible — so watch it rather than measuring once.
    const measure = () => setHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitActiveSlide, index]);

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
      <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
        <div
          ref={trackRef}
          onScroll={onScroll}
          style={fitActiveSlide && height ? { height } : undefined}
          className={cn(
            "flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            // 4:3 on phones so the breakdown slide has room; the 1200x630 cover letterboxes into it.
            fitActiveSlide
              ? "items-start transition-[height] duration-[var(--duration-fast)]"
              : "aspect-[4/3] sm:aspect-[1200/630]",
          )}
        >
          {slides.map((slide, i) => (
            // biome-ignore lint/a11y/useSemanticElements: the ARIA carousel pattern wants role="group" on a slide, not a fieldset.
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: slides are a fixed, ordered deck.
              key={i}
              ref={(el) => {
                slideRefs.current[i] = el;
              }}
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
        )}
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
    </section>
  );
}

/**
 * Arrows sit outside the media frame (in the card's padding) so they never cover the slide
 * content — the generated session card fills the frame edge to edge.
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
