const KEYWORDS =
  /\b(import|from|export|const|let|var|await|async|function|return|new|type|interface|extends|if|else|for|of|throw|try|catch|class|implements|public|private|readonly|true|false|null|undefined)\b/g;

function escapeHtml(source: string): string {
  return source.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Tiny dependency-free highlighter tuned to the design system's palette. */
function highlight(source: string): string {
  const escaped = escapeHtml(source);
  const parts: string[] = [];
  // Split out strings and comments first so keywords inside them stay plain.
  const pattern = /(\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(escaped)) !== null) {
    const plain = escaped.slice(lastIndex, match.index);
    parts.push(plain.replace(KEYWORDS, '<span class="tok-kw">$1</span>'));
    const token = match[0];
    if (token.startsWith("//")) {
      parts.push(`<span class="tok-comment">${token}</span>`);
    } else {
      parts.push(`<span class="tok-str">${token}</span>`);
    }
    lastIndex = match.index + token.length;
  }
  parts.push(escaped.slice(lastIndex).replace(KEYWORDS, '<span class="tok-kw">$1</span>'));
  return parts.join("");
}

export function CodeBlock({ code, title }: { code: string; title?: string }) {
  return (
    <figure className="min-w-0 overflow-hidden rounded-xs border border-line bg-bone-raised">
      {title && (
        <figcaption className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="label-mono">{title}</span>
          <span className="flex gap-1.5">
            <span className="size-[6px] rounded-full bg-line-strong" />
            <span className="size-[6px] rounded-full bg-line-strong" />
            <span className="size-[6px] rounded-full bg-green" />
          </span>
        </figcaption>
      )}
      <div className="overflow-x-auto">
        <pre className="p-4 font-mono text-[12.5px] leading-[1.7] text-ink-soft [&_.tok-kw]:text-green-deep [&_.tok-str]:text-gold-deep [&_.tok-comment]:text-grey-faint [&_.tok-comment]:italic">
          <code dangerouslySetInnerHTML={{ __html: highlight(code) }} />
        </pre>
      </div>
    </figure>
  );
}
