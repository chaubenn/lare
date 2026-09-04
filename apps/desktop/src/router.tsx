import { createMemoryRouter, Link, Navigate } from "react-router";
import { EmptyState } from "@/components/ui/States";
import { LoginPage } from "@/features/auth/LoginPage";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { DraftEditorPage } from "@/features/drafts/DraftEditorPage";
import { DraftsPage } from "@/features/drafts/DraftsPage";
import { FeedPage } from "@/features/feed/FeedPage";
import { FriendsPage } from "@/features/friends/FriendsPage";
import { PostPage } from "@/features/posts/PostPage";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { UserProfilePage } from "@/features/profile/UserProfilePage";
import { RecordingsPage } from "@/features/recordings/RecordingsPage";
import { SessionReviewPage } from "@/features/sessions/SessionReviewPage";
import { SessionsPage } from "@/features/sessions/SessionsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AppShell } from "@/features/shell/AppShell";
import { RootLayout } from "@/features/shell/RootLayout";
import { StudioEditorPage } from "@/features/studio/StudioEditorPage";

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
              { path: "/drafts", element: <DraftsPage /> },
              { path: "/drafts/:id", element: <DraftEditorPage /> },
              { path: "/sessions", element: <SessionsPage /> },
              { path: "/sessions/:id", element: <SessionReviewPage /> },
              { path: "/recordings", element: <RecordingsPage /> },
              { path: "/studio/:recordingId", element: <StudioEditorPage /> },
              { path: "/profile", element: <ProfilePage /> },
              { path: "/u/:handle", element: <UserProfilePage /> },
              { path: "/friends", element: <FriendsPage /> },
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
