import { describe, expect, it } from "vitest";
import {
  type AppNotification,
  describeNotification,
  type NotificationLinks,
  notificationActorName,
  parseNotifications,
} from "./notifications";

const LINKS: NotificationLinks = {
  post: (post) => `/p/${post.slug}`,
  profile: (handle) => `/u/${handle}`,
  requests: "/friends?tab=requests",
};

const base: AppNotification = {
  id: "n1",
  type: "follow",
  created_at: "2026-09-15T10:00:00Z",
  read_at: null,
  actor: { handle: "bob", display_name: "Bob", avatar_url: null },
  post: null,
};
const post = { id: "p1", slug: "two-sum", title: "Two Sum in O(n)" };

describe("describeNotification", () => {
  it("links post activity to the post", () => {
    expect(describeNotification({ ...base, type: "post_like", post }, LINKS)).toEqual({
      text: "Bob liked your post “Two Sum in O(n)”",
      href: "/p/two-sum",
    });
    expect(
      describeNotification(
        { ...base, type: "post_comment", post: { ...post, title: null } },
        LINKS,
      ),
    ).toEqual({ text: "Bob commented on your post", href: "/p/two-sum" });
  });

  it("links follows to the person, and requests to the requests tab", () => {
    expect(describeNotification(base, LINKS)).toEqual({
      text: "Bob started following you",
      href: "/u/bob",
    });
    expect(describeNotification({ ...base, type: "follow_request" }, LINKS)).toEqual({
      text: "Bob requested to follow you",
      href: "/friends?tab=requests",
    });
    expect(describeNotification({ ...base, type: "follow_accepted" }, LINKS)).toEqual({
      text: "Bob accepted your follow request",
      href: "/u/bob",
    });
  });

  it("falls back when the actor is missing", () => {
    expect(describeNotification({ ...base, actor: null }, LINKS)).toEqual({
      text: "Someone started following you",
      href: null,
    });
  });
});

describe("notificationActorName", () => {
  it("prefers the display name, then the handle", () => {
    expect(notificationActorName({ handle: "bob", display_name: " ", avatar_url: null })).toBe(
      "@bob",
    );
    expect(notificationActorName(null)).toBe("Someone");
  });
});

describe("parseNotifications", () => {
  it("keeps valid rows and drops the rest", () => {
    expect(parseNotifications([base, { ...base, type: "nope" }])).toEqual([base]);
    expect(parseNotifications(null)).toEqual([]);
  });
});
