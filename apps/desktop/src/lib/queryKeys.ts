/**
 * Every React Query key in the app, and the named groups of keys that go stale together.
 *
 * A key with an `all` form is invalidated by prefix somewhere; `all` is that prefix and `of` the
 * key of one query under it.
 */

import type { QueryClient, QueryKey } from "@tanstack/react-query";

type Maybe = string | null | undefined;

export const queryKeys = {
  appVersion: ["app-version"] as const,
  authProviders: ["auth-providers"] as const,
  profile: (userId: string) => ["profile", userId] as const,

  feed: {
    all: ["feed"] as const,
    of: (scope: string) => ["feed", scope] as const,
  },
  userPosts: {
    all: ["user-posts"] as const,
    of: (userId: Maybe) => ["user-posts", userId] as const,
  },
  post: {
    all: ["post"] as const,
    of: (id: string) => ["post", id] as const,
  },
  postMedia: (postId: string) => ["post-media", postId] as const,
  postComments: {
    all: ["post-comments"] as const,
    of: (postId: string) => ["post-comments", postId] as const,
  },
  postLike: (postId: string) => ["post-like", postId] as const,
  postLikes: {
    all: ["post-likes"] as const,
    of: (userId: string, postIds: string[]) => ["post-likes", userId, postIds] as const,
  },
  mentionSuggestions: {
    all: ["mention-suggestions"] as const,
    of: (term: string) => ["mention-suggestions", term] as const,
  },
  interviewReview: (sessionId: Maybe) => ["interview-review", sessionId] as const,

  drafts: {
    all: ["drafts"] as const,
    of: (userId: string) => ["drafts", userId] as const,
  },
  draft: {
    all: ["draft"] as const,
    of: (id: string) => ["draft", id] as const,
  },
  tracked: {
    all: ["tracked"] as const,
    of: (userId: string) => ["tracked", userId] as const,
  },

  sessions: {
    all: ["sessions"] as const,
    of: (userId: string) => ["sessions", userId] as const,
  },
  /** Everything about one session sits under `of(id)`, so one prefix refreshes its whole page. */
  session: {
    all: ["session"] as const,
    of: (id: string) => ["session", id] as const,
    detail: (id: string, userId: string) => ["session", id, userId] as const,
    post: (id: string) => ["session", id, "post"] as const,
    transcript: (id: string) => ["session", id, "transcript"] as const,
    video: (id: string) => ["session", id, "video"] as const,
    editLog: (id: string, problemId: string) => ["session", id, "edit-log", problemId] as const,
  },
  reviewCriteria: {
    all: ["review-criteria"] as const,
    of: (userId: string) => ["review-criteria", userId] as const,
  },

  following: {
    all: ["following"] as const,
    of: (userId: string) => ["following", userId] as const,
  },
  followers: {
    all: ["followers"] as const,
    of: (userId: string) => ["followers", userId] as const,
  },
  /** One edge, a state. Not under `followStates`, whose entries hold a record of states. */
  followState: {
    all: ["follow-state"] as const,
    of: (userId: string, targetId: string) => ["follow-state", userId, targetId] as const,
  },
  followStates: {
    all: ["follow-states"] as const,
    of: (userId: string, sortedIds: readonly string[]) =>
      ["follow-states", userId, sortedIds.join(",")] as const,
  },
  followRequests: {
    all: ["follow-requests"] as const,
    of: (userId: string) => ["follow-requests", userId] as const,
  },
  followList: {
    all: ["follow-list"] as const,
    of: (handle: Maybe, kind: string) => ["follow-list", handle, kind] as const,
  },
  profileSearch: {
    all: ["profile-search"] as const,
    of: (query: string) => ["profile-search", query] as const,
  },
  publicProfile: {
    all: ["public-profile"] as const,
    of: (handle: Maybe) => ["public-profile", handle] as const,
  },
  profileStats: {
    all: ["profile-stats"] as const,
    of: (handle: Maybe) => ["profile-stats", handle] as const,
  },
  solvedActivity: {
    all: ["solved-activity"] as const,
    of: (handle: Maybe) => ["solved-activity", handle] as const,
  },
  solvedSkills: {
    all: ["solved-skills"] as const,
    of: (handle: Maybe) => ["solved-skills", handle] as const,
  },

  weeklyLeaderboard: {
    all: ["weekly-leaderboard"] as const,
    of: (userId: string, weekOffset: number) => ["weekly-leaderboard", userId, weekOffset] as const,
  },
  globalLeaderboard: {
    all: ["global-leaderboard"] as const,
    of: (userId: string, weekOffset: number) => ["global-leaderboard", userId, weekOffset] as const,
  },

  notifications: {
    all: ["notifications"] as const,
    of: (userId: string) => ["notifications", userId] as const,
  },
  notificationsUnread: {
    all: ["notifications-unread"] as const,
    of: (userId: string) => ["notifications-unread", userId] as const,
  },
  goalProgress: {
    all: ["goal-progress"] as const,
    of: (userId: string) => ["goal-progress", userId] as const,
  },

  recorder: {
    permissions: ["recorder", "permissions"] as const,
    permissionSettingsUrl: (which: string) =>
      ["recorder", "permission-settings-url", which] as const,
    devices: ["recorder", "devices"] as const,
    settings: ["recorder", "settings"] as const,
    recordings: ["recorder", "recordings"] as const,
    whisperModels: ["recorder", "whisper-models"] as const,
  },
  video: (id: string) => ["video", id] as const,
  localCopies: {
    all: ["local-copies"] as const,
    of: (videoId: Maybe) => ["local-copies", videoId] as const,
  },
  playbackToken: (videoId: string) => ["playback-token", videoId] as const,
};

function invalidateAll(queryClient: QueryClient, keys: readonly QueryKey[]): Promise<void> {
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(
    () => undefined,
  );
}

const POST_CARDS = [queryKeys.feed.all, queryKeys.userPosts.all];

const PUBLISHED_POST_LISTS = [
  ...POST_CARDS,
  queryKeys.profileStats.all,
  queryKeys.sessions.all,
  queryKeys.drafts.all,
];

/**
 * What to refetch after a change. Each resolves once the active queries have refetched; callers
 * that should not wait `void` it.
 */
export const refresh = {
  /** Feed and profile cards embed a post's counts, first comments and carousel. */
  postCards: (queryClient: QueryClient) => invalidateAll(queryClient, POST_CARDS),

  /** A post appeared in, or left, the published lists: cards, the post count, its session row. */
  publishedPostLists: (queryClient: QueryClient) =>
    invalidateAll(queryClient, PUBLISHED_POST_LISTS),

  /** Every list a post, a draft or a tracked problem shows up in. */
  everyPostList: (queryClient: QueryClient) =>
    invalidateAll(queryClient, [
      ...PUBLISHED_POST_LISTS,
      queryKeys.session.all,
      queryKeys.draft.all,
      queryKeys.tracked.all,
    ]),

  /**
   * Every list that shows an edge or a count after the follow graph changes: following,
   * unfollowing, and accepting or declining a request. Following a private account is also what
   * makes its posts, activity and skills visible.
   */
  followGraph: (queryClient: QueryClient) =>
    invalidateAll(queryClient, [
      queryKeys.following.all,
      queryKeys.followers.all,
      queryKeys.followState.all,
      queryKeys.followStates.all,
      queryKeys.followRequests.all,
      queryKeys.followList.all,
      queryKeys.profileStats.all,
      queryKeys.solvedActivity.all,
      queryKeys.solvedSkills.all,
      queryKeys.publicProfile.all,
      queryKeys.userPosts.all,
      queryKeys.feed.all,
      queryKeys.weeklyLeaderboard.all,
    ]),

  /**
   * After the signed-in user changes their name, handle, avatar or privacy. Posts, comments,
   * people lists, notifications and the boards all embed the author's profile columns.
   */
  authorViews: (queryClient: QueryClient) =>
    invalidateAll(queryClient, [
      queryKeys.feed.all,
      queryKeys.userPosts.all,
      queryKeys.post.all,
      queryKeys.postComments.all,
      queryKeys.publicProfile.all,
      queryKeys.profileStats.all,
      queryKeys.followList.all,
      queryKeys.following.all,
      queryKeys.followers.all,
      queryKeys.followRequests.all,
      queryKeys.notifications.all,
      queryKeys.weeklyLeaderboard.all,
      queryKeys.globalLeaderboard.all,
      queryKeys.profileSearch.all,
      queryKeys.mentionSuggestions.all,
    ]),

  /** The notification list and the unread badge. */
  notifications: (queryClient: QueryClient) =>
    invalidateAll(queryClient, [queryKeys.notifications.all, queryKeys.notificationsUnread.all]),

  /** Recordings on this device, and the local copies that play in place of a cloud video. */
  recordings: (queryClient: QueryClient) =>
    invalidateAll(queryClient, [queryKeys.recorder.recordings, queryKeys.localCopies.all]),
};
