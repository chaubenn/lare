"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";

/** Apple's exponential-decay endpoint projection (not v²/2a). */
function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive edge resistance. `overshoot` and `dimension` in the same unit. */
function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (1 - 1 / ((overshoot * constant) / dimension + 1)) * dimension;
}

const SAMPLE_WINDOW_MS = 100;
const DIRECTION_LOCK_PX = 10;

interface Sample {
  t: number;
  x: number;
  y: number;
}

function velocityFrom(samples: Sample[], axis: "x" | "y"): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const firstSample = samples[0];
  if (!last || !firstSample) return 0;
  const cutoff = last.t - SAMPLE_WINDOW_MS;
  let first = firstSample;
  for (const s of samples) {
    if (s.t >= cutoff) {
      first = s;
      break;
    }
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return ((last[axis] - first[axis]) / dt) * 1000;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface DragToPageOptions {
  page: number;
  pageCount: number;
  onPageChange: (next: number) => void;
  /** Page width in px. Defaults to the element's clientWidth. */
  pageWidth?: number;
  axis?: "x" | "y";
  disabled?: boolean;
}

/**
 * Pointer-capture 1:1 drag with velocity history, ~10px hysteresis before committing
 * a direction, endpoint projection to choose the target page, then a spring handed
 * the release velocity. Reverse-vs-commit is decided on velocity sign, not position.
 *
 * The pointer is captured only once a drag has actually committed to our axis, never
 * on pointerdown. Capturing early retargets the eventual `click` to this element, so
 * a plain tap on a control *inside* a page — the play button on a video slide — would
 * be swallowed and never reach its handler. Deferring means a tap behaves like a tap
 * and a swipe can still start anywhere, including on top of that button.
 */
export function useDragToPage(
  ref: RefObject<HTMLElement | null>,
  { page, pageCount, onPageChange, pageWidth, axis = "x", disabled = false }: DragToPageOptions,
) {
  const state = useRef({
    page,
    pageCount,
    onPageChange,
    pageWidth,
    axis,
    disabled,
  });
  state.current = { page, pageCount, onPageChange, pageWidth, axis, disabled };

  const dragging = useRef(false);
  const captured = useRef(false);
  const start = useRef({ x: 0, y: 0, page: 0 });
  const samples = useRef<Sample[]>([]);
  const offset = useRef(0);
  const locked = useRef<"x" | "y" | null>(null);

  const applyOffset = useCallback(
    (px: number) => {
      const el = ref.current;
      if (!el) return;
      offset.current = px;
      el.style.transform =
        state.current.axis === "x" ? `translate3d(${px}px,0,0)` : `translate3d(0,${px}px,0)`;
    },
    [ref],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (prefersReducedMotion()) return;
      dragging.current = true;
      locked.current = null;
      captured.current = false;
      start.current = { x: event.clientX, y: event.clientY, page: state.current.page };
      samples.current = [{ t: event.timeStamp, x: event.clientX, y: event.clientY }];
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      // Without an early capture we can miss a pointerup that happens off the
      // element, so drop a drag whose button/contact is already gone.
      if (event.buttons === 0) {
        dragging.current = false;
        return;
      }
      samples.current.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
      if (samples.current.length > 8) samples.current.shift();

      const dx = event.clientX - start.current.x;
      const dy = event.clientY - start.current.y;
      if (!locked.current) {
        if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
        locked.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (locked.current !== state.current.axis) return;

      // Committed to a real swipe: take the pointer now, so the rest of the drag is
      // ours wherever it travels and the release does not land as a click.
      if (!captured.current) {
        captured.current = true;
        try {
          el.setPointerCapture(event.pointerId);
        } catch {
          // Pointer already gone; the drag ends on the next event.
        }
      }

      const raw = state.current.axis === "x" ? dx : dy;
      const width = state.current.pageWidth ?? el.clientWidth;
      const atStart = start.current.page <= 0 && raw > 0;
      const atEnd = start.current.page >= state.current.pageCount - 1 && raw < 0;
      const next = atStart || atEnd ? rubberband(Math.abs(raw), width) * Math.sign(raw) : raw;
      applyOffset(next);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      const wasCaptured = captured.current;
      captured.current = false;
      try {
        if (wasCaptured) el.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }

      const width = state.current.pageWidth ?? el.clientWidth;
      const vel = velocityFrom(samples.current, state.current.axis);
      const projected = offset.current + project(vel);
      let next = start.current.page;

      if (locked.current === state.current.axis) {
        if (vel !== 0) {
          // Velocity sign decides commit vs reverse.
          next = vel < 0 ? start.current.page + 1 : start.current.page - 1;
        } else if (Math.abs(projected) > width * 0.35) {
          next = projected < 0 ? start.current.page + 1 : start.current.page - 1;
        }
      }

      next = Math.max(0, Math.min(state.current.pageCount - 1, next));
      applyOffset(0);
      el.style.transform = "";
      if (next !== state.current.page) state.current.onPageChange(next);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [applyOffset, disabled, ref]);
}
