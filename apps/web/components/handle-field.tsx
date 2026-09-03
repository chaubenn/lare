"use client";

import { useState } from "react";
import { HANDLE_RE } from "@/lib/parse";
import { inputClass, labelClass } from "@/lib/styles";

/** Handle input that lowercases as you type and shows the validation rule inline. */
export function HandleField({
  defaultValue = "",
  error,
}: {
  defaultValue?: string;
  error: string | null;
}) {
  const [value, setValue] = useState(defaultValue);
  const touched = value.length > 0;
  const valid = HANDLE_RE.test(value);

  return (
    <div className="space-y-1.5">
      <label htmlFor="handle" className={labelClass}>
        Handle
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-500">
          @
        </span>
        <input
          id="handle"
          name="handle"
          value={value}
          onChange={(e) => setValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          minLength={3}
          maxLength={20}
          pattern="[a-z0-9_]{3,20}"
          required
          aria-invalid={error ? true : touched && !valid ? true : undefined}
          aria-describedby="handle-hint"
          className={`${inputClass} pl-7`}
        />
      </div>
      <p
        id="handle-hint"
        className={`text-xs ${error || (touched && !valid) ? "text-rose-300" : "text-zinc-500"}`}
      >
        {error ?? "3–20 characters: lowercase letters, numbers and underscores."}
      </p>
    </div>
  );
}
