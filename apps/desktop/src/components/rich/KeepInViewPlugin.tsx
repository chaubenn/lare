import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";

/** Room left between what is kept in view and the edge it would otherwise touch. */
const MARGIN = 16;

/**
 * Keeps typing visible. The editor's text area has a capped height and scrolls inside itself, so
 * this keeps the caret inside that area, then scrolls the page so the whole editor and the buttons
 * that go with it (the form it sits in, or an element marked `data-editor-scope`) are on screen.
 *
 * Lexical scrolls to the caret on its own, but on an empty line WebKit reports the caret as an
 * empty rectangle, so pressing Enter a few times walked it off the bottom of the window.
 */
export function KeepInViewPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let frame = 0;
    const unregister = editor.registerUpdateListener(() => {
      const root = editor.getRootElement();
      if (!root?.contains(document.activeElement)) return;
      cancelAnimationFrame(frame);
      // After the browser has laid out the change.
      frame = requestAnimationFrame(() => {
        keepCaretInside(root);
        const panel = root.closest<HTMLElement>("[data-rich-editor]") ?? root;
        const scope =
          panel.closest<HTMLElement>("[data-editor-scope]") ?? panel.closest("form") ?? panel;
        keepOnScreen(scope);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      unregister();
    };
  }, [editor]);

  return null;
}

/** Where the caret is drawn; on an empty line, the line itself. */
function caretRect(root: HTMLElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.focusNode) return null;
  if (!root.contains(selection.focusNode)) return null;
  const range = document.createRange();
  range.setStart(selection.focusNode, selection.focusOffset);
  range.collapse(true);
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (rect.height > 0) return rect;
  const node = selection.focusNode;
  const child = node.childNodes[selection.focusOffset];
  const element =
    child instanceof Element ? child : node instanceof Element ? node : node.parentElement;
  return element?.getBoundingClientRect() ?? null;
}

function keepCaretInside(root: HTMLElement) {
  const caret = caretRect(root);
  if (!caret || root.scrollHeight <= root.clientHeight) return;
  const box = root.getBoundingClientRect();
  const pad = 8;
  if (caret.bottom > box.bottom - pad) root.scrollTop += caret.bottom - (box.bottom - pad);
  else if (caret.top < box.top + pad) root.scrollTop -= box.top + pad - caret.top;
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if ((overflowY === "auto" || overflowY === "scroll") && at.scrollHeight > at.clientHeight) {
      return at;
    }
  }
  return null;
}

/** Scrolls the page the least it can to show all of `element`; its top wins if it can't fit. */
function keepOnScreen(element: HTMLElement) {
  const scroller = scrollParent(element);
  if (!scroller) return;
  const view = scroller.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  let delta = 0;
  if (rect.bottom > view.bottom - MARGIN) delta = rect.bottom - (view.bottom - MARGIN);
  if (rect.top - delta < view.top + MARGIN) delta = rect.top - (view.top + MARGIN);
  if (delta !== 0) scroller.scrollTop += delta;
}
