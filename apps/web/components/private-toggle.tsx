import { Lock } from "lucide-react";

/** Checkbox styled as a settings row. Works without JS (plain form field named `is_private`). */
export function PrivateToggle({ defaultChecked }: { defaultChecked: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 hover:border-zinc-700">
      <input
        type="checkbox"
        name="is_private"
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 shrink-0 accent-amber-500"
      />
      <span className="flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-100">
          <Lock className="size-3.5 text-zinc-500" />
          Private account
        </span>
        <span className="mt-0.5 block text-xs text-zinc-500">
          People must request to follow you, and only accepted followers see your posts.
        </span>
      </span>
    </label>
  );
}
