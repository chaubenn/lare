"use client";

import { FieldError, Input, Label } from "@lare/ui/primitives";
import { useState } from "react";
import { HANDLE_RE } from "@/lib/parse";

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
  const invalid = Boolean(error) || (touched && !valid);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="handle">Handle</Label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[var(--text-tertiary)]">
          @
        </span>
        <Input
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
          aria-invalid={invalid ? true : undefined}
          aria-describedby="handle-hint"
          className="pl-7"
        />
      </div>
      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <p
          id="handle-hint"
          className={`text-xs ${invalid ? "text-[var(--lare-danger)]" : "text-[var(--text-tertiary)]"}`}
        >
          3–20 characters: lowercase letters, numbers and underscores.
        </p>
      )}
    </div>
  );
}
