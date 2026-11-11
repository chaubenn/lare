import { z } from "zod";

/** A calendar day as the database's RPCs return it: `YYYY-MM-DD`. */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CountSchema = z.number().int().nonnegative();

export const SessionKindSchema = z.enum(["practice", "interview"]);
export type SessionKind = z.infer<typeof SessionKindSchema>;
