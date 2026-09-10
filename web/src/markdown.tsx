import type { ReactNode } from "react";

/** Minimal markdown renderer: headings, bold/italic, links, lists, tables, hr. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(
        <a key={`${keyPrefix}-${i}`} href={m[3]} target="_blank" rel="noreferrer">
          {m[2]}
        </a>,
      );
    } else if (m[4] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-${i}`}>{m[5]}</strong>);
    } else if (m[6] !== undefined) {
      nodes.push(<em key={`${keyPrefix}-${i}`}>{m[7]}</em>);
    } else {
      nodes.push(<code key={`${keyPrefix}-${i}`}>{m[9]}</code>);
    }
    i++;
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] | null = null;
  let table: string[][] | null = null;

  const flushList = (key: string) => {
    if (list && list.length > 0) {
      blocks.push(
        <ul key={key}>
          {list.map((item, n) => (
            <li key={n}>{inline(item, `${key}-${n}`)}</li>
          ))}
        </ul>,
      );
    }
    list = null;
  };
  const flushTable = (key: string) => {
    if (table && table.length > 0) {
      const [head, ...rows] = table;
      blocks.push(
        <table key={key}>
          <thead>
            <tr>
              {(head ?? []).map((cell, n) => (
                <th key={n}>{inline(cell, `${key}-h${n}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, n) => (
                  <td key={n}>{inline(cell, `${key}-${r}-${n}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
    }
    table = null;
  };

  lines.forEach((line, idx) => {
    const key = `b${idx}`;
    if (/^\s*[-*] /.test(line)) {
      flushTable(key);
      list ??= [];
      list.push(line.replace(/^\s*[-*] /, ""));
      return;
    }
    if (line.trim().startsWith("|")) {
      flushList(key);
      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return; // separator row
      table ??= [];
      table.push(cells);
      return;
    }
    flushList(key);
    flushTable(key);
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1]!.length;
      const content = inline(heading[2]!, key);
      if (level === 1) blocks.push(<h1 key={key}>{content}</h1>);
      else if (level === 2) blocks.push(<h2 key={key}>{content}</h2>);
      else if (level === 3) blocks.push(<h3 key={key}>{content}</h3>);
      else blocks.push(<h4 key={key}>{content}</h4>);
      return;
    }
    if (/^\s*---+\s*$/.test(line)) {
      blocks.push(<hr key={key} />);
      return;
    }
    if (line.trim() === "") return;
    blocks.push(<p key={key}>{inline(line, key)}</p>);
  });
  flushList("end");
  flushTable("end");
  return <div className="markdown">{blocks}</div>;
}
