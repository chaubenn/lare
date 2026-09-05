# Lare design system

Locked brand for every frontend (web, desktop, extension). Hallmark treats this as the source of truth: pages share the system rather than rotating themes.

## Intent

Lare is a practice log for LeetCode. The voice is utilitarian and quiet — a notebook, not a launch page. No invented metrics, no fake chrome, no gradient marks.

## Mark

- **Emblem:** the white eight-point ink star from the supplied logo. Used alone for favicons, the Chrome extension icon, and the pillowed desktop app icon.
- **Wordmark:** emblem + the word “Lare” (capital L, geometric sans). Used in headers, login, and the landing masthead.
- Do not redraw the star as a geometric asterisk. Do not put a letter “L” on a green–cyan tile.

## Colour

Neutral, professional, warm ink — not cool zinc, not amber, not emerald.

| Token | Hex | Use |
| --- | --- | --- |
| `--lare-ink` | `#0c0c0b` | Page ground |
| `--lare-ink-2` | `#161615` | Raised surfaces |
| `--lare-line` | `#2a2a27` | Hairlines |
| `--lare-muted` | `#8a8780` | Secondary copy |
| `--lare-bone` | `#f0ece4` | Primary actions, display type |
| `--lare-paper` | `#f7f4ee` | Hover on primary |
| `--lare-focus` | `#c8c2b6` | Focus rings |

Semantic status colours (run / pause / stop, Easy / Medium / Hard) stay distinct from the brand accent. Primary buttons are bone on ink.

## Type

- **UI / display:** Outfit (geometric sans, close to the wordmark).
- **Code / timers:** IBM Plex Mono.
- Headings are roman. Emphasis is weight or bone, never italic display type.

## Motion

transitions.dev tokens in `packages/ui/src/motion.css`. Use the named recipes (text reveal, dropdown, toast, badge pop, learn-more shift). Honour `prefers-reduced-motion`.

## Genre

modern-minimal. Custom theme (ink / bone) because the brand mark is a specific black–white emblem, not a catalog swatch.
