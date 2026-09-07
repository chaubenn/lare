"use client";

import { cn } from "@lare/ui/cn";
import { useDragToPage } from "@lare/ui/gesture";
import { Button } from "@lare/ui/primitives";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Instagram-style swipe deck. Pointer-capture drag pages the slides; native scroll-snap
 * stays as the reduced-motion fallback (touch, trackpad, keyboard).
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const [reduced, setReduced] = useState(false);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useDragToPage(dragRef, {
    page: index,
    pageCount: slides.length,
    onPageChange: (next) => goTo(next),
    pageWidth: width || undefined,
    disabled: reduced || slides.length < 2,
  });

  function goTo(next: number) {
    const clamped = Math.max(0, Math.min(slides.length - 1, next));
    setIndex(clamped);
    if (reduced) {
      const track = trackRef.current;
      if (track) track.scrollTo({ left: clamped * track.clientWidth, behavior: "smooth" });
    }
  }

  const readIndex = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const next = Math.round(track.scrollLeft / track.clientWidth);
    setIndex((prev) => (next !== prev ? next : prev));
  }, []);

  function onScroll() {
    if (raf.current != null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      readIndex();
    });
  }

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !reduced) return;
    const onEnd = () => readIndex();
    track.addEventListener("scrollend", onEnd);
    return () => track.removeEventListener("scrollend", onEnd);
  }, [readIndex, reduced]);

  if (slides.length === 0) return null;

  function slideBody(slide: ReactNode, i: number) {
    const mounted = Math.abs(i - index) <= 1;
    if (!mounted) return null;
    if (isValidElement(slide)) {
      return cloneElement(slide as ReactElement<{ active?: boolean }>, { active: i === index });
    }
    return slide;
  }

  return (
    <section
      aria-roledescription="carousel"
      aria-label={label}
      className={cn("relative", className)}
    >
      <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div ref={viewportRef} className="aspect-[4/3] sm:aspect-[1200/630]">
          {reduced ? (
            <div
              ref={trackRef}
              onScroll={onScroll}
              className="flex size-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                  {slideBody(slide, i)}
                </div>
              ))}
            </div>
          ) : (
            <div
              className="flex size-full transition-transform duration-(--duration-fast) ease-(--ease-smooth-out)"
              style={{ transform: width ? `translate3d(${-index * width}px,0,0)` : undefined }}
            >
              <div ref={dragRef} className="flex h-full">
                {slides.map((slide, i) => (
                  // biome-ignore lint/a11y/useSemanticElements: the ARIA carousel pattern wants role="group" on a slide, not a fieldset.
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: slides are a fixed, ordered deck.
                    key={i}
                    role="group"
                    aria-roledescription="slide"
                    aria-label={`${i + 1} of ${slides.length}`}
                    className="h-full shrink-0"
                    style={{ width: width || "100%" }}
                  >
                    {slideBody(slide, i)}
                  </div>
                ))}
              </div>
            </div>
          )}
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
                  i === index
                    ? "bg-[var(--text)]"
                    : "bg-[color-mix(in_oklab,var(--text)_35%,transparent)] hover:bg-[color-mix(in_oklab,var(--text)_60%,transparent)]",
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
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      tooltip={label}
      className={cn(
        "absolute top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-[color-mix(in_oklab,var(--surface)_60%,transparent)] text-[var(--text)] ring-1 ring-white/10 backdrop-blur hover:bg-[color-mix(in_oklab,var(--surface)_80%,transparent)] disabled:pointer-events-none disabled:opacity-0 sm:inline-flex",
        side === "left" ? "-left-3 sm:-left-4" : "-right-3 sm:-right-4",
      )}
    >
      {side === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
    </Button>
  );
}
