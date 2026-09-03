import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { envError } from "@/lib/env";
import { queryClient } from "@/lib/queryClient";
import { router } from "@/router";

function ConfigError({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div role="alert" className="max-w-lg rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
        <h1 className="text-base font-semibold text-rose-200">Lare is not configured</h1>
        <p className="mt-2 select-text text-sm text-rose-300/80">{message}</p>
      </div>
    </div>
  );
}

export function App() {
  if (envError) return <ConfigError message={envError} />;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
