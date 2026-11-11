/**
 * Every in-app address. The router's patterns are built from the same functions (with `:id` in
 * place of a value), so a link and the route it targets cannot drift apart.
 *
 * `packages/shared/src/search/search.ts` and the Rust deep-link handler spell some of these out
 * themselves; a path changed here has to change there too.
 */

/** Path prefixes of pages that sit under another page's sidebar section. */
export const routePrefixes = { posts: "/posts", users: "/u/" } as const;

export const routes = {
  feed: "/",
  followingFeed: "/?scope=following",
  login: "/login",
  drafts: "/drafts",
  draft: (id: string) => `/drafts/${id}`,
  post: (id: string) => `${routePrefixes.posts}/${id}`,
  postEdit: (id: string) => `${routePrefixes.posts}/${id}/edit`,
  sessions: "/sessions",
  session: (id: string) => `/sessions/${id}`,
  profile: "/profile",
  profileEdit: "/profile/edit",
  user: (handle: string) => `${routePrefixes.users}${handle}`,
  friends: "/friends",
  findFriends: "/friends?tab=find",
  followRequests: "/friends?tab=requests",
  /** Where follow requests lived before they became a friends tab; redirects there. */
  legacyRequests: "/requests",
  leaderboard: "/leaderboard",
  notifications: "/notifications",
  settings: "/settings",
} as const;

/** A draft opens in the editor; anything published (or pending) opens as a post. */
export function postRoute(post: { id: string; status: string }): string {
  return post.status === "draft" ? routes.draft(post.id) : routes.post(post.id);
}
