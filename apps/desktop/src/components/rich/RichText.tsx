import {
  detectCodeLanguage,
  PLAIN_CODE,
  parseRichText,
  type RichBlock,
  type RichInline,
} from "@lare/shared";
import { CodeBlock, cn } from "@lare/ui";
import { Fragment } from "react";
import { Link } from "react-router";
import { ProfileHoverCard } from "@/features/profile/ProfileHoverCard";
import { openExternal } from "@/lib/open";
import { routes } from "@/lib/routes";
import { RICH } from "./styles";

/**
 * Renders a write-up or comment with its formatting. Nothing here goes through HTML: every node
 * is a React element, so a body can't smuggle markup in. `mentions` links each `@handle` to that
 * person, which only means something where the database notifies them (comments).
 */
export function RichText({
  source,
  mentions = false,
  className,
}: {
  source: string;
  mentions?: boolean;
  className?: string;
}) {
  const blocks = parseRichText(source);
  return (
    <div className={cn("select-text whitespace-pre-wrap break-words", className)}>
      {blocks.map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional and never reorder
        <Block key={i} block={block} mentions={mentions} />
      ))}
    </div>
  );
}

/**
 * The same text on one run of lines, for previews that sit inline after a name: blocks run
 * together with a space, list items keep a bullet, code blocks read as inline code.
 */
export function RichTextInline({
  source,
  mentions = false,
}: {
  source: string;
  mentions?: boolean;
}) {
  const runs: { key: string; nodes: RichInline[]; bullet?: boolean }[] = [];
  parseRichText(source).forEach((block, i) => {
    if (block.kind === "paragraph" || block.kind === "heading")
      runs.push({ key: `${i}`, nodes: block.content });
    else if (block.kind === "quote")
      for (const [j, nodes] of block.lines.entries()) runs.push({ key: `${i}.${j}`, nodes });
    else if (block.kind === "list")
      for (const [j, nodes] of block.items.entries())
        runs.push({ key: `${i}.${j}`, nodes, bullet: true });
    else
      runs.push({ key: `${i}`, nodes: [{ kind: "code", text: block.text.replace(/\s+/g, " ") }] });
  });
  return (
    <>
      {runs
        .filter((run) => run.nodes.length > 0 || run.bullet)
        .map((run, i) => (
          <Fragment key={run.key}>
            {i > 0 ? " " : ""}
            {run.bullet ? "• " : ""}
            <Inline nodes={run.nodes} mentions={mentions} />
          </Fragment>
        ))}
    </>
  );
}

function Block({ block, mentions }: { block: RichBlock; mentions: boolean }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p className={RICH.paragraph}>
          {block.content.length > 0 ? <Inline nodes={block.content} mentions={mentions} /> : <br />}
        </p>
      );
    case "heading": {
      const Tag = `h${block.level}` as const;
      return (
        <Tag className={RICH[Tag]}>
          <Inline nodes={block.content} mentions={mentions} />
        </Tag>
      );
    }
    case "list": {
      const items = block.items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items are positional and never reorder
        <li key={i} className={RICH.li}>
          <Inline nodes={item} mentions={mentions} />
        </li>
      ));
      return block.ordered ? (
        <ol className={RICH.ol} start={block.start}>
          {items}
        </ol>
      ) : (
        <ul className={RICH.ul}>{items}</ul>
      );
    }
    case "quote":
      return (
        <blockquote className={RICH.quote}>
          {block.lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and never reorder
            <p key={i}>{line.length > 0 ? <Inline nodes={line} mentions={mentions} /> : <br />}</p>
          ))}
        </blockquote>
      );
    case "code": {
      // Nobody picked a language: guess, as the editor does while you type.
      const language =
        block.language === PLAIN_CODE ? null : (block.language ?? detectCodeLanguage(block.text));
      return (
        <CodeBlock code={block.text || " "} lang={language} className="my-1.5" maxHeight={560} />
      );
    }
  }
}

function Inline({ nodes, mentions }: { nodes: RichInline[]; mentions: boolean }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case "text":
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
            return <Fragment key={i}>{node.text}</Fragment>;
          case "code":
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
              <code key={i} className={RICH.code}>
                {node.text}
              </code>
            );
          case "link":
            return (
              <a
                // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
                key={i}
                href={node.url}
                className={RICH.link}
                onClick={(e) => {
                  // The webview would navigate itself away; links belong in the system browser.
                  e.preventDefault();
                  void openExternal(node.url);
                }}
              >
                {node.url}
              </a>
            );
          case "mention":
            return mentions ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
              <ProfileHoverCard key={i} handle={node.handle}>
                <Link to={routes.user(node.handle)} className={RICH.mention}>
                  @{node.handle}
                </Link>
              </ProfileHoverCard>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
              <Fragment key={i}>@{node.handle}</Fragment>
            );
          default: {
            const Tag = node.kind === "bold" ? "strong" : node.kind === "italic" ? "em" : "s";
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
              <Tag key={i} className={RICH[node.kind]}>
                <Inline nodes={node.children} mentions={mentions} />
              </Tag>
            );
          }
        }
      })}
    </>
  );
}
