export type { Database, Json, Tables, TablesInsert, TablesUpdate, Enums } from "./database.types";
export { Constants } from "./database.types";

import type { Database } from "./database.types";

type PublicSchema = Database["public"];

export type Profile = PublicSchema["Tables"]["profiles"]["Row"];
export type Follow = PublicSchema["Tables"]["follows"]["Row"];
export type Session = PublicSchema["Tables"]["sessions"]["Row"];
export type SessionEvent = PublicSchema["Tables"]["session_events"]["Row"];
export type SessionProblem = PublicSchema["Tables"]["session_problems"]["Row"];
export type Submission = PublicSchema["Tables"]["submissions"]["Row"];
export type Video = PublicSchema["Tables"]["videos"]["Row"];
export type Post = PublicSchema["Tables"]["posts"]["Row"];
export type Transcript = PublicSchema["Tables"]["transcripts"]["Row"];
export type InterviewReview = PublicSchema["Tables"]["interview_reviews"]["Row"];

export type SessionInsert = PublicSchema["Tables"]["sessions"]["Insert"];
export type SessionProblemInsert = PublicSchema["Tables"]["session_problems"]["Insert"];
export type SubmissionInsert = PublicSchema["Tables"]["submissions"]["Insert"];
export type PostInsert = PublicSchema["Tables"]["posts"]["Insert"];
export type VideoInsert = PublicSchema["Tables"]["videos"]["Insert"];
