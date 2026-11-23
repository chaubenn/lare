/**
 * Facecam preview (`?window=camera`): an always-on-top bubble showing the webcam, captured as
 * part of the screen recording. The camera is opened with getUserMedia so it works without any
 * Rust plumbing.
 *
 * The bubble is the whole window, so moving, resizing and reshaping it move and resize the
 * window. Rust owns that geometry (`camera.rs`) and remembers it between takes; this only asks
 * for a shape and a height, and says when a move or resize is over.
 *
 * This window outlives the recording that opened it (it is hidden, not closed), so the stream is
 * tied to `camera:active` from Rust rather than to the component's lifetime. Without that the
 * camera light would stay on between takes.
 */

import { cn } from "@lare/ui";
import { EyeOff, FlipHorizontal } from "@lare/ui/icons";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type CameraLayout, type CameraShape, recorder } from "@/lib/recorder";
import { DEFAULT_CAMERA_SHORTCUT, describeAccelerator, isMac } from "@/lib/shortcuts";
import { inTauri, useTauriEvent } from "@/lib/tauri";
import { OverlayTooltip, ShortcutCaps, useOverlayTooltips } from "./overlayTooltips";

const SHAPES: { shape: CameraShape; label: string }[] = [
  { shape: "circle", label: "Circle" },
  { shape: "square", label: "Square" },
  { shape: "rectangle", label: "Rectangle" },
  { shape: "pillow", label: "Pillow" },
];

/**
 * Corner rounding per shape, as shares of the width and of the height. They are set so every
 * corner is circular.
 */
const RADII: Record<CameraShape, [number, number]> = {
  circle: [0.5, 0.5],
  square: [0.16, 0.16],
  rectangle: [0.11, 0.195],
  pillow: [0.32, 0.42],
};

const radius = (shape: CameraShape) => {
  const [x, y] = RADII[shape];
  return `${x * 100}% / ${y * 100}%`;
};

/**
 * How far in from the bounding box's corner, as a share of the height, the shape's edge crosses
 * the diagonal: `r·(1 − 1/√2)` for a corner of radius `r`. The resize grip sits there, on the
 * bubble's rim.
 */
const RIM: Record<CameraShape, number> = {
  circle: 0.146,
  square: 0.047,
  rectangle: 0.057,
  pillow: 0.123,
};

/** Matches `PAD` in `camera.rs`: the window's transparent margin around the bubble (`p-1`). */
const PAD = 4;
const GRIP = 14;
/** A move has settled once the window has been still this long. */
const SETTLE_MS = 300;

/**
 * Where the toolbar sits, as shares of the bubble's height from its bottom edge: as low as
 * subtitles, but raised as far as the top bound where the shape's rounding would cut it off.
 */
const BAR_LOWEST = 0.07;
const BAR_HIGHEST = 0.3;
/** Room kept between the toolbar's ends and the bubble's rim, in points. */
const BAR_MARGIN = 6;

export function CameraWindow() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [mirror, setMirror] = useState(true);
  // The keys that hide the bubble, as the user has set them (null when turned off). Read again
  // at the start of each take: the window is reused, and the setting can change between.
  const [hideShortcut, setHideShortcut] = useState<string | null>(DEFAULT_CAMERA_SHORTCUT);
  // The window is only ever built to be shown, so the first take needs no event to start.
  const [active, setActive] = useState(true);
  const [layout, setLayout] = useState<CameraLayout | null>(null);
  // Outside the desktop app (a plain browser) the webview's own hover is all there is.
  const [pointerOver, setPointerOver] = useState(false);
  // Whether the pointer is on the bubble or its grip, not just the window: the window is the
  // bubble's bounding box, and a round bubble leaves its corners empty.
  const [nativeOver, setNativeOver] = useState(false);
  const { pointed, shown, target } = useOverlayTooltips("camera:pointer");

  useTauriEvent("camera:active", setActive);
  useTauriEvent("camera:pointer", (at) => {
    const el = at ? document.elementFromPoint(at[0], at[1]) : null;
    setNativeOver(Boolean(el?.closest("[data-bubble]")));
  });

  const bubbleRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const bar = useBarPlacement(bubbleRef, barRef, layout?.shape ?? "circle");

  useEffect(() => {
    if (!active) return;
    recorder
      .cameraLayout()
      .then(setLayout)
      .catch(() => undefined);
  }, [active]);

  const resize = useResize(layout, setLayout);
  useSettleAfterMove(resize.resizingRef, setLayout);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        const settings = await recorder.settings().catch(() => null);
        if (settings) {
          const saved = settings.cameraShortcut;
          setHideShortcut(saved === "" ? null : (saved ?? DEFAULT_CAMERA_SHORTCUT));
        }
        const constraints: MediaTrackConstraints = {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        };
        if (settings?.cameraId) constraints.deviceId = { ideal: settings.cameraId };
        stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (stream) for (const t of stream.getTracks()) t.stop();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [active]);

  const hideKeys = hideShortcut
    ? describeAccelerator(hideShortcut, isMac).join(isMac ? "" : "+")
    : "";

  const shape = layout?.shape ?? "circle";
  const showControls = (inTauri ? nativeOver : pointerOver) || resize.resizing;

  const pickShape = (next: CameraShape) => {
    if (!layout || next === layout.shape) return;
    recorder
      .resizeCamera(next, layout.height)
      .then(() => recorder.settleCamera())
      .then(setLayout)
      .catch(() => undefined);
  };

  const hide = () => {
    recorder.tuckCameraWindow().catch(() => undefined);
  };

  // A press on the picture moves the window. Started by hand rather than with
  // `data-tauri-drag-region`, which only answers presses on the element carrying it (the video
  // covers it) and maximises the window on a double click.
  const startMove = (e: ReactMouseEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget || !inTauri) return;
    e.preventDefault();
    getCurrentWindow()
      .startDragging()
      .catch(() => undefined);
  };

  return (
    <div
      className="relative size-full p-1"
      onPointerEnter={(e) => e.pointerType === "mouse" && setPointerOver(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setPointerOver(false)}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the window's drag surface, like a title bar. */}
      <div
        ref={bubbleRef}
        data-bubble
        onMouseDown={startMove}
        style={{ borderRadius: radius(shape) }}
        className="relative size-full cursor-grab overflow-hidden border-2 border-[var(--border)] bg-zinc-900 shadow-2xl active:cursor-grabbing"
      >
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          className={cn("pointer-events-none size-full object-cover", mirror && "-scale-x-100")}
        />
        {error ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-rose-300">
            {error}
          </div>
        ) : null}

        <div
          ref={barRef}
          role="toolbar"
          aria-label="Facecam controls"
          style={{ bottom: bar.bottom, transform: `translateX(-50%) scale(${bar.scale})` }}
          className={cn(
            "absolute left-1/2 flex origin-bottom items-center gap-0.5 rounded-full p-1",
            // Frosted glass: the picture shows through, blurred and a touch brighter.
            "border border-white/20 bg-white/[0.12] backdrop-blur-xl backdrop-saturate-150",
            "shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_6px_20px_rgb(0_0_0/0.35)]",
            "transition-opacity duration-150",
            showControls ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          {SHAPES.map((s, i) => (
            <span key={s.shape} className="relative flex" {...target(s.shape)}>
              <ControlButton
                label={s.label}
                pressed={s.shape === shape}
                hot={pointed === s.shape}
                onClick={() => pickShape(s.shape)}
              >
                <span
                  aria-hidden
                  className="block border-[1.5px] border-current"
                  style={glyph(s.shape)}
                />
              </ControlButton>
              <OverlayTooltip show={shown === s.shape} align={i === 0 ? "start" : "center"} gap={8}>
                {s.label}
              </OverlayTooltip>
            </span>
          ))}
          <span className="mx-0.5 h-3.5 w-px bg-white/25" aria-hidden />
          <span className="relative flex" {...target("mirror")}>
            <ControlButton
              label={mirror ? "Un-mirror camera" : "Mirror camera"}
              pressed={mirror}
              hot={pointed === "mirror"}
              onClick={() => setMirror((m) => !m)}
            >
              <FlipHorizontal className="size-3.5" aria-hidden />
            </ControlButton>
            <OverlayTooltip show={shown === "mirror"} gap={8}>
              {mirror ? "Un-mirror camera" : "Mirror camera"}
            </OverlayTooltip>
          </span>
          <span className="relative flex" {...target("hide")}>
            <ControlButton
              label={hideKeys ? `Hide (${hideKeys} toggles it)` : "Hide"}
              hot={pointed === "hide"}
              onClick={hide}
            >
              <EyeOff className="size-3.5" aria-hidden />
            </ControlButton>
            <OverlayTooltip show={shown === "hide"} align="end" gap={8}>
              Hide
              {hideShortcut ? <ShortcutCaps accelerator={hideShortcut} /> : null}
            </OverlayTooltip>
          </span>
        </div>
      </div>

      {layout ? (
        <span
          aria-hidden
          data-bubble
          {...target("resize")}
          onPointerDown={resize.onPointerDown}
          onPointerMove={resize.onPointerMove}
          onPointerUp={resize.onPointerUp}
          onPointerCancel={resize.onPointerUp}
          style={gripPlacement(layout)}
          className={cn(
            "absolute rounded-full border border-black/30 bg-white shadow-md transition-[opacity,transform] duration-150",
            layout.corner === "bottomRight" || layout.corner === "topLeft"
              ? "cursor-nwse-resize"
              : "cursor-nesw-resize",
            (pointed === "resize" || resize.resizing) && "scale-125",
            showControls ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <OverlayTooltip
            show={shown === "resize" && !resize.resizing}
            // The grip is at the corner facing away from the anchored one; its tooltip points inward.
            side={layout.corner.startsWith("top") ? "top" : "bottom"}
            align={layout.corner.endsWith("Left") ? "end" : "start"}
            gap={6}
          >
            Drag to resize
          </OverlayTooltip>
        </span>
      ) : null}
    </div>
  );
}

function ControlButton({
  label,
  pressed,
  hot,
  onClick,
  children,
}: {
  label: string;
  /** A toggle's state; leave out for a plain button. */
  pressed?: boolean;
  /** The pointer is on it: macOS gets no CSS hover in the bubble (see `overlayTooltips.tsx`). */
  hot: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "lare-press grid size-6 place-items-center rounded-full transition-colors",
        pressed
          ? "bg-white/25 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]"
          : "text-white/75 hover:bg-white/15 hover:text-white",
        hot && !pressed && "bg-white/15 text-white",
      )}
    >
      {children}
    </button>
  );
}

/** A small outline of each shape for its button, in the shape's own proportions and rounding. */
function glyph(shape: CameraShape): CSSProperties {
  const size: Record<CameraShape, [number, number]> = {
    circle: [10, 10],
    square: [10, 10],
    rectangle: [14, 8],
    pillow: [12, 9],
  };
  const [width, height] = size[shape];
  return { width, height, borderRadius: radius(shape) };
}

/**
 * Where the toolbar goes: its bottom edge's distance from the bubble's, and how far it is shrunk.
 * As low as the shape lets it sit with its ends clear of the rim; a bubble too small for that,
 * even at the top bound, gets a smaller toolbar instead.
 */
function useBarPlacement(
  bubbleRef: RefObject<HTMLDivElement | null>,
  barRef: RefObject<HTMLDivElement | null>,
  shape: CameraShape,
) {
  const [sizes, setSizes] = useState({ w: 0, h: 0, bar: 0 });

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    const bar = barRef.current;
    if (!bubble || !bar) return;
    // Layout sizes, untouched by the toolbar's own scale.
    const measure = () =>
      setSizes({ w: bubble.clientWidth, h: bubble.clientHeight, bar: bar.offsetWidth });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bubble);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [bubbleRef, barRef]);

  const { w, h, bar } = sizes;
  if (!w || !h || !bar) return { bottom: `${BAR_LOWEST * 100}%`, scale: 1 };

  const [fx, fy] = RADII[shape];
  const rx = fx * w;
  const ry = fy * h;
  // The bubble's width at `d` points above its bottom edge.
  const chord = (d: number) =>
    d >= ry ? w : w - 2 * (rx - rx * Math.sqrt(1 - ((ry - d) / ry) ** 2));
  const need = bar + 2 * BAR_MARGIN;
  // The lowest `d` where the bubble is `need` wide.
  const inset = (w - need) / 2;
  const fits =
    inset < 0
      ? Number.POSITIVE_INFINITY
      : inset >= rx
        ? 0
        : ry * (1 - Math.sqrt(1 - ((rx - inset) / rx) ** 2));
  const bottom = Math.min(Math.max(fits, BAR_LOWEST * h), BAR_HIGHEST * h);
  const scale = Math.min(1, (chord(bottom) - 2 * BAR_MARGIN) / bar);
  return { bottom, scale };
}

/** The grip goes on the rim at the corner facing away from the one the bubble is anchored to. */
function gripPlacement(layout: CameraLayout): CSSProperties {
  const inset = PAD + RIM[layout.shape] * layout.height - GRIP / 2;
  const fromBottom = layout.corner === "topLeft" || layout.corner === "topRight";
  const fromRight = layout.corner === "topLeft" || layout.corner === "bottomLeft";
  return {
    width: GRIP,
    height: GRIP,
    [fromBottom ? "bottom" : "top"]: inset,
    [fromRight ? "right" : "left"]: inset,
  };
}

/**
 * Dragging the grip resizes the bubble away from its anchored corner. Measured in screen points,
 * since the window moves under the pointer as it grows. Rust is asked for one size at a time; any
 * pointer moves in between collapse into the latest.
 */
function useResize(layout: CameraLayout | null, setLayout: (layout: CameraLayout) => void) {
  const [resizing, setResizing] = useState(false);
  const resizingRef = useRef(false);
  const start = useRef<{ x: number; y: number; height: number; aspect: number } | null>(null);
  const wanted = useRef<number | null>(null);
  const sending = useRef(false);

  const send = async (shape: CameraShape) => {
    if (sending.current) return;
    sending.current = true;
    while (wanted.current !== null) {
      const height = wanted.current;
      wanted.current = null;
      try {
        setLayout(await recorder.resizeCamera(shape, height));
      } catch {
        break;
      }
    }
    sending.current = false;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!layout || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const bubble = e.currentTarget.parentElement?.firstElementChild;
    const aspect = bubble ? bubble.clientWidth / Math.max(bubble.clientHeight, 1) : 1;
    start.current = { x: e.screenX, y: e.screenY, height: layout.height, aspect };
    resizingRef.current = true;
    setResizing(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const from = start.current;
    if (!from || !layout) return;
    const growsLeft = layout.corner === "topRight" || layout.corner === "bottomRight";
    const growsUp = layout.corner === "bottomLeft" || layout.corner === "bottomRight";
    const alongX = ((e.screenX - from.x) * (growsLeft ? -1 : 1)) / from.aspect;
    const alongY = (e.screenY - from.y) * (growsUp ? -1 : 1);
    const grow = Math.abs(alongX) > Math.abs(alongY) ? alongX : alongY;
    wanted.current = Math.round(from.height + grow);
    void send(layout.shape);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!start.current) return;
    start.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // Let the last size land before the layout is saved.
    const settle = () => {
      if (sending.current) {
        window.setTimeout(settle, 16);
        return;
      }
      resizingRef.current = false;
      setResizing(false);
      recorder
        .settleCamera()
        .then(setLayout)
        .catch(() => undefined);
    };
    settle();
  };

  return { resizing, resizingRef, onPointerDown, onPointerMove, onPointerUp };
}

/** Once the window has stopped moving (an OS drag has no end event here), save where it is. */
function useSettleAfterMove(
  resizingRef: RefObject<boolean>,
  setLayout: (layout: CameraLayout) => void,
) {
  useEffect(() => {
    if (!inTauri) return;
    let timer: number | undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWindow()
      .onMoved(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          if (resizingRef.current) return;
          recorder
            .settleCamera()
            .then(setLayout)
            .catch(() => undefined);
        }, SETTLE_MS);
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unlisten?.();
    };
  }, [resizingRef, setLayout]);
}
