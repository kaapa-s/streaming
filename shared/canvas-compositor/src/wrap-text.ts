/** Split `text` into lines that each measure at most `maxWidth`. */
export function wrapTextLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines?: number,
): string[] {
  if (maxWidth <= 0) return [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let line = '';

  const flush = () => {
    if (line === '') return;
    lines.push(line);
    line = '';
  };

  for (const word of words) {
    for (const piece of breakToken(word, maxWidth, measure)) {
      if (line === '') {
        line = piece;
        continue;
      }
      const candidate = `${line} ${piece}`;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
      } else {
        flush();
        line = piece;
      }
    }
  }
  flush();

  if (maxLines === undefined || lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(1, maxLines));
  const last = kept.length - 1;
  const lastLine = kept[last];
  if (lastLine !== undefined) {
    kept[last] = ellipsizeLine(lastLine, maxWidth, measure);
  }
  return kept;
}

function ellipsizeLine(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  const ellipsis = '…';
  if (measure(ellipsis) > maxWidth) return text;
  let cut = text;
  while (cut.length > 0 && measure(cut + ellipsis) > maxWidth) {
    cut = [...cut].slice(0, -1).join('');
  }
  return `${cut}${ellipsis}`;
}

function breakToken(
  token: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  if (measure(token) <= maxWidth) return [token];

  const parts: string[] = [];
  let current = '';
  for (const ch of token) {
    const next = current + ch;
    if (current !== '' && measure(next) > maxWidth) {
      parts.push(current);
      current = ch;
    } else {
      current = next;
    }
  }
  if (current !== '') parts.push(current);
  return parts;
}
