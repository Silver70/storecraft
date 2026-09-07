import type { ContentSlotType } from '../../../shared/database/schema';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Resolves the entities a word processor's HTML is full of, so what gets
 * stored is the sentence the merchant wrote rather than its transport
 * encoding. Run before tags are stripped, so an encoded tag is neutralised as
 * a tag rather than surviving as one.
 */
function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, body: string) => {
      if (body.startsWith('#')) {
        const code = body.toLowerCase().startsWith('#x')
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return ENTITIES[body.toLowerCase()] ?? match;
    },
  );
}

// A tag opens with a letter, or a slash and a letter, so prose like
// "5 < 3 > 1" survives being pasted while `<b>` does not.
const SCRIPTS = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const COMMENTS = /<!--[\s\S]*?-->|<![^>]*>/g;
// A tag that separated two blocks of text becomes the break it was; every
// other tag simply goes, so `<b>sorted</b>.` reads as the merchant wrote it
// rather than acquiring a space before the full stop.
const BLOCKS =
  /<\/?(?:p|div|br|hr|li|ul|ol|tr|td|th|table|h[1-6]|section|article|aside|header|footer|blockquote|pre)\b[^>]*>/gi;
const TAGS = /<\/?[a-z][^>]*>/gi;
// Characters no storefront can render, dropped before storage.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Reduces whatever the merchant pasted to the text of it. A Slot holds text,
 * never markup: a Store cannot acquire injected markup through its own CMS,
 * and nothing downstream has to decide whether a stored value is safe to
 * render. Tags are removed rather than escaped, because what the merchant
 * meant to paste was the words.
 *
 * A single-line content type never acquires a newline from a paste, which is
 * what stops a headline from becoming three lines the storefront cannot lay
 * out. Nothing is truncated here — an oversized value is refused by the
 * caller, so a merchant is told rather than finding a sentence missing later.
 */
export function toSlotText(value: string, type: ContentSlotType): string {
  const text = decodeEntities(value)
    .replace(SCRIPTS, ' ')
    .replace(COMMENTS, ' ')
    .replace(BLOCKS, '\n')
    .replace(TAGS, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '');
  const collapsed =
    type === 'heading'
      ? text.replace(/\s+/g, ' ')
      : text.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return collapsed.trim();
}
