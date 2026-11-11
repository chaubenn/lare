import { createMemoryRouter, Link, Navigate } from "react-router";
import { EmptyState } from "@/components/ui/States";
import { LoginPage } from "@/features/auth/LoginPage";
import { FeedPage } from "@/features/feed/FeedPage";
import { FriendsPage } from "@/features/friends/FriendsPage";
import { LeaderboardPage } from "@/features/leaderboard/LeaderboardPage";
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
import { RequireAuth } from "@/features/shell/RequireAuth";
import { RootLayout } from "@/features/shell/RootLayout";
import { routes } from "@/lib/routes";

function NotFound() {
  return (
    <div className="p-8">
      <EmptyState
        title="Page not found"
        action={
          <Link to={routes.feed} className="text-sm text-emerald-400 hover:underline">
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
      { path: routes.login, element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <FeedPage /> },
              { path: routes.post(":id"), element: <PostPage /> },
              { path: routes.postEdit(":id"), element: <PostEditPage /> },
              { path: routes.drafts, element: <DraftsPage /> },
              // The editor has its own step rail, so it starts at the sidebar instead of centring.
              {
                path: routes.draft(":id"),
                element: <DraftEditorPage />,
                handle: { fullWidth: true },
              },
              { path: routes.sessions, element: <SessionsPage /> },
              { path: routes.session(":id"), element: <SessionReviewPage /> },
              { path: routes.profile, element: <ProfilePage /> },
              { path: routes.profileEdit, element: <ProfileEditor /> },
              { path: routes.user(":handle"), element: <UserProfilePage /> },
              { path: routes.friends, element: <FriendsPage /> },
              { path: routes.leaderboard, element: <LeaderboardPage /> },
              { path: routes.notifications, element: <NotificationsPage /> },
              {
                path: routes.legacyRequests,
                element: <Navigate to={routes.followRequests} replace />,
              },
              { path: routes.settings, element: <SettingsPage /> },
              { path: "*", element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]);
