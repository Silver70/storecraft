import { toSlotText } from './slot-text.util';

/**
 * A Slot holds text. What matters is what a merchant would observe: the words
 * they pasted survive, and the markup that came with them does not reach the
 * Store — including markup that arrived encoded, which is the shape a paste
 * from a rich editor actually takes.
 */
describe('toSlotText', () => {
  it('keeps the words and drops the markup around them', () => {
    expect(toSlotText('<h1>Winter, <b>sorted</b>.</h1>', 'heading')).toBe(
      'Winter, sorted.',
    );
  });

  it('neutralises markup that arrives encoded', () => {
    // Encoded or not, a script is a script: it is resolved first and then
    // dropped whole, so nothing it was carrying reaches the Store either.
    expect(toSlotText('&lt;script&gt;alert(1)&lt;/script&gt;', 'text')).toBe(
      '',
    );
    expect(toSlotText('&#60;b&#62;Bold&#60;/b&#62;', 'text')).toBe('Bold');
  });

  it('drops a script and everything it was carrying', () => {
    expect(
      toSlotText('Sale <script>steal(document.cookie)</script>now', 'text'),
    ).toBe('Sale now');
  });

  it('resolves the entities a word processor leaves behind', () => {
    expect(toSlotText('Tea&nbsp;&amp;&nbsp;biscuits', 'text')).toBe(
      'Tea & biscuits',
    );
  });

  it('leaves prose that merely looks like markup alone', () => {
    expect(toSlotText('5 < 3 > 1 is false', 'text')).toBe('5 < 3 > 1 is false');
  });

  it('never lets a headline acquire a line break', () => {
    expect(toSlotText('Winter\nkit\nis here', 'heading')).toBe(
      'Winter kit is here',
    );
  });

  it('keeps the paragraphs of a text slot', () => {
    expect(toSlotText('First line\r\n\r\nSecond line', 'text')).toBe(
      'First line\n\nSecond line',
    );
  });

  it('truncates nothing — an oversized value comes back whole to be refused', () => {
    const long = 'a'.repeat(5000);
    expect(toSlotText(long, 'heading')).toHaveLength(5000);
  });
});
