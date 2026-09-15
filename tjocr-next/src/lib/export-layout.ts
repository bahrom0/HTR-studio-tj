export type ExportLayoutSeparator = 'none' | 'line' | 'paragraph';

export interface ExportLayoutItem {
  index: number;
  separatorBefore: ExportLayoutSeparator;
  indent: number;
}

export interface ExportTextLine {
  index: number;
  text: string;
}

const separators = new Set<ExportLayoutSeparator>(['none', 'line', 'paragraph']);

/** Keep layout metadata independent from OCR text and user corrections. */
export function normalizeExportLayout(
  input: unknown,
  expectedIndexes: readonly number[],
): ExportLayoutItem[] | null {
  if (!Array.isArray(input) || input.length !== expectedIndexes.length) return null;
  const expected = new Set(expectedIndexes);
  const received = new Set<number>();
  const normalized: ExportLayoutItem[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') return null;
    const candidate = item as Record<string, unknown>;
    const index = candidate.index;
    const separatorBefore = candidate.separatorBefore;
    const indent = candidate.indent;
    if (
      typeof index !== 'number' || !Number.isInteger(index) || !expected.has(index) || received.has(index)
      || typeof separatorBefore !== 'string' || !separators.has(separatorBefore as ExportLayoutSeparator)
      || typeof indent !== 'number' || !Number.isInteger(indent) || indent < 0 || indent > 6
    ) return null;
    received.add(index);
    normalized.push({ index, separatorBefore: separatorBefore as ExportLayoutSeparator, indent });
  }
  if (received.size !== expected.size) return null;
  return normalized.sort((a, b) => a.index - b.index);
}

export function defaultExportLayout(expectedIndexes: readonly number[]): ExportLayoutItem[] {
  return expectedIndexes.map((index, position) => ({
    index,
    separatorBefore: position === 0 ? 'none' : 'line',
    indent: 0,
  }));
}

export function formatExportText(
  lines: readonly ExportTextLine[],
  layout: readonly ExportLayoutItem[],
): string {
  const byIndex = new Map(layout.map((item) => [item.index, item]));
  let output = '';
  for (const [position, line] of lines.entries()) {
    const item = byIndex.get(line.index);
    const separator = position === 0 ? '' : item?.separatorBefore === 'paragraph'
      ? '\n\n' : item?.separatorBefore === 'none' ? ' ' : '\n';
    // Recognised text itself is never trimmed or rewritten. Empty failed lines
    // remain blank rather than becoming whitespace-only paragraphs.
    output += `${separator}${line.text ? '    '.repeat(item?.indent ?? 0) : ''}${line.text}`;
  }
  return output;
}
