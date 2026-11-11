// Values the fixture server (plain Node), the fake desktop, the Playwright config and the spec
// have to agree on. `.env.e2e` repeats the port: it is what the e2e build of the extension uses.

export const FIXTURE_PORT = 4173;
export const FIXTURE_ORIGIN = `http://localhost:${FIXTURE_PORT}`;

/** The user the fixture's fake Supabase session belongs to. */
export const USER_ID = "00000000-0000-4000-8000-000000000001";
/** The single practice-inbox session id the mock `practice_inbox` RPC hands out. */
export const INBOX_SESSION_ID = "00000000-0000-4000-8000-0000000000b0";
/** The fake desktop's pairing secret, which the fixture serves from `bridge_secrets`. */
export const PAIRING_SECRET = "e2e0".repeat(16);
