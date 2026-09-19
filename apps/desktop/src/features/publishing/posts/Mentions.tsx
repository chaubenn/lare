import { insertMention, mentionAtCaret, splitMentions } from "@lare/shared";
import { cn } from "@lare/ui";
import { type ComponentProps, type KeyboardEvent, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { Avatar } from "@/components/ui/Avatar";
import { Textarea } from "@/components/ui/Field";
import { useMentionSuggestions } from "./social";

/** A comment body with each `@handle` linked to that person's profile. */
export function CommentText({ body }: { body: string }) {
  return (
    <>
      {splitMentions(body).map((segment, i) =>
        segment.kind === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
          <span key={i}>{segment.text}</span>
        ) : (
          <Link
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
            key={i}
            to={`/u/${segment.handle}`}
            className="font-medium text-[var(--accent)] hover:underline"
          >
            @{segment.handle}
          </Link>
        ),
      )}
    </>
  );
}

type TextareaProps = Omit<ComponentProps<"textarea">, "value" | "onChange">;

/**
 * A textarea that offers people to mention after `@`. Arrow keys move through the list, Enter or
 * Tab picks, Escape closes; with the list closed every key behaves as in a plain textarea.
 */
export function MentionTextarea({
  value,
  onValueChange,
  ...rest
}: TextareaProps & { value: string; onValueChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);

  const mention = caret === null ? null : mentionAtCaret(value, caret);
  const open = mention !== null && dismissedAt !== mention.start;
  const suggestions = useMentionSuggestions(open ? mention.query : null);
  const options = open ? (suggestions.data ?? []) : [];
  const shown = options.length > 0;
  const index = Math.min(active, Math.max(options.length - 1, 0));

  const syncCaret = () => setCaret(ref.current?.selectionStart ?? null);

  const pick = (handle: string) => {
    if (!mention) return;
    const next = insertMention(value, mention, handle);
    onValueChange(next.text);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shown) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((index + step + options.length) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const option = options[index];
        if (option) {
          e.preventDefault();
          pick(option.handle);
          return;
        }
      }
      if (e.key === "Escape" && mention) {
        e.preventDefault();
        e.stopPropagation();
        setDismissedAt(mention.start);
        return;
      }
    }
    rest.onKeyDown?.(e);
  };

  return (
    <div className="relative">
      <Textarea
        {...rest}
        ref={ref}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown ? `${listId}-${index}` : undefined}
        onChange={(e) => {
          onValueChange(e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onBlur={(e) => {
          setCaret(null);
          rest.onBlur?.(e);
        }}
      />
      {shown ? (
        <div
          id={listId}
          role="listbox"
          aria-label="People to mention"
          className="absolute left-2 z-20 mt-1 w-64 overflow-hidden rounded-[var(--lare-r-2)] border border-[var(--border)] bg-[var(--surface-raised)] py-1 shadow-lg"
        >
          {options.map((option, i) => (
            <div
              key={option.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === index}
              tabIndex={-1}
              // mousedown, so the pick lands before the textarea's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(option.handle);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
                i === index && "bg-[color-mix(in_oklab,var(--text)_8%,transparent)]",
              )}
            >
              <Avatar
                url={option.avatar_url}
                name={option.display_name ?? option.handle}
                size={20}
              />
              <span className="truncate text-[var(--text)]">
                {option.display_name ?? `@${option.handle}`}
              </span>
              {option.display_name ? (
                <span className="truncate text-xs text-[var(--text-tertiary)]">
                  @{option.handle}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
