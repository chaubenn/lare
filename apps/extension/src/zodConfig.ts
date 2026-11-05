/**
 * Import for its side effect from every extension entrypoint that parses with zod.
 *
 * Zod 4 probes `new Function("")` to decide whether to compile its object parsers. The extension
 * CSP forbids `unsafe-eval`, so the probe throws (zod catches it and falls back) but Chrome still
 * logs a CSP violation on chrome://extensions > Errors. `jitless` skips the probe.
 */
import { z } from "zod";

z.config({ jitless: true });
