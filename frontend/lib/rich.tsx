import { Fragment, type ReactNode } from "react";

/**
 * A translated sentence with some of its {placeholders} filled by elements, so a figure can stay
 * bold or a name can stay a link whatever order the language puts the words in.
 */
export function rich(template: string, parts: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/).map((piece, i) => {
    const m = /^\{(\w+)\}$/.exec(piece);
    return <Fragment key={i}>{m && m[1] in parts ? parts[m[1]] : piece}</Fragment>;
  });
}
