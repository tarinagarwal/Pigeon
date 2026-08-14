import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isExternalUrl } from "@/lib/is-external-url";

type AnchorProps = ComponentPropsWithoutRef<"a"> & {
  node?: unknown;
};

function createBlogLink(isBot: boolean) {
  return function BlogLink({ href, children, node: _node, ...props }: AnchorProps) {
    if (!href) {
      return <a {...props}>{children}</a>;
    }

    if (isExternalUrl(href)) {
      if (isBot) {
        return (
          <a href={href} rel="nofollow noopener noreferrer" target="_blank" {...props}>
            {children}
          </a>
        );
      }
      return (
        <a href={href} target="_blank" {...props}>
          {children}
        </a>
      );
    }

    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
}

export function BlogMarkdown({
  children,
  isBot,
}: {
  children: string;
  isBot: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: createBlogLink(isBot),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
