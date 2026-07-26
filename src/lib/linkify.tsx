import { Fragment } from "react";

const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;

/**
 * Turns plain-text URLs in chat messages, posts, and help responses into real
 * <a> elements, so they're clickable and route through
 * ExternalLinkInterceptor's document-level click guard rather than the
 * browser navigating away untouched.
 */
export function renderLinkifiedText(text: string): React.ReactNode {
  const parts = text.split(URL_PATTERN);
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    // split() with a captured group alternates plain text / match, starting
    // with plain text — odd indices are always URLs.
    if (i % 2 === 1) {
      // Trim trailing punctuation a sentence commonly ends a URL with, so
      // "check https://x.com." doesn't swallow the period into the link.
      const trailing = part.match(/[).,!?]+$/)?.[0] ?? "";
      const href = trailing ? part.slice(0, -trailing.length) : part;
      return (
        <Fragment key={i}>
          <a
            href={href}
            className="break-all text-accent underline underline-offset-2"
          >
            {href}
          </a>
          {trailing}
        </Fragment>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
