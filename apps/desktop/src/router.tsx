import { createMemoryRouter, Link, Navigate } from "react-router";
import { EmptyState } from "@/components/ui/States";
import { LoginPage } from "@/features/auth/LoginPage";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { FeedPage } from "@/features/feed/FeedPage";
import { FriendsPage } from "@/features/friends/FriendsPage";
import { NotificationsPage } from "@/features/notifications/NotificationsPage";
import { ProfileEditor } from "@/features/profile/ProfileEditor";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { UserProfilePage } from "@/features/profile/UserProfilePage";
import { DraftEditorPage } from "@/features/publishing/drafts/DraftEditorPage";
import { DraftsPage } from "@/features/publishing/drafts/DraftsPage";
import { PostEditPage } from "@/features/publishing/posts/PostEditPage";
import { PostPage } from "@/features/publishing/posts/PostPage";
import { SessionReviewPage } from "@/features/sessions/SessionReviewPage";
import { SessionsPage } from "@/features/sessions/SessionsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AppShell } from "@/features/shell/AppShell";
import { RootLayout } from "@/features/shell/RootLayout";

function NotFound() {
  return (
    <div className="p-8">
      <EmptyState
        title="Page not found"
        action={
          <Link to="/" className="text-sm text-emerald-400 hover:underline">
            Back to feed
          </Link>
        }
      />
    </div>
  );
}

export const router = createMemoryRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/login", element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <FeedPage /> },
              { path: "/posts/:id", element: <PostPage /> },
              { path: "/posts/:id/edit", element: <PostEditPage /> },
              { path: "/drafts", element: <DraftsPage /> },
              // The editor has its own step rail, so it starts at the sidebar instead of centring.
              { path: "/drafts/:id", element: <DraftEditorPage />, handle: { fullWidth: true } },
              { path: "/sessions", element: <SessionsPage /> },
              { path: "/sessions/:id", element: <SessionReviewPage /> },
              { path: "/profile", element: <ProfilePage /> },
              { path: "/profile/edit", element: <ProfileEditor /> },
              { path: "/u/:handle", element: <UserProfilePage /> },
              { path: "/friends", element: <FriendsPage /> },
              { path: "/notifications", element: <NotificationsPage /> },
              // Follow requests moved into the friends tab.
              { path: "/requests", element: <Navigate to="/friends?tab=requests" replace /> },
              { path: "/settings", element: <SettingsPage /> },
              { path: "*", element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]);
