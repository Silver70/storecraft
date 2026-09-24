import {
  coverFor,
  endedAtFor,
  type CardAd,
  type CardAdLifetime,
} from './campaign-card.util';

const ad = (
  id: string,
  creativeUrl: string | null,
  createdAt = '2026-01-01T00:00:00Z',
): CardAd => ({ id, creativeUrl, createdAt: new Date(createdAt) });

const lifetime = (
  entries: Record<string, [spend: number, lastDay: string]>,
): Map<string, CardAdLifetime> =>
  new Map(
    Object.entries(entries).map(([id, [spend, lastDay]]) => [
      id,
      { spend, lastDay },
    ]),
  );

describe('coverFor', () => {
  it('keeps the Campaign’s own Cover', () => {
    expect(
      coverFor(
        'own.jpg',
        [ad('a', 'a.jpg')],
        lifetime({ a: [100, '2026-01-02'] }),
      ),
    ).toBe('own.jpg');
  });

  it('falls back to the creative of the Ad that spent the most', () => {
    expect(
      coverFor(
        null,
        [ad('a', 'a.jpg'), ad('b', 'b.jpg'), ad('c', 'c.jpg')],
        lifetime({
          a: [100, '2026-01-02'],
          b: [900, '2026-01-02'],
          c: [50, '2026-01-02'],
        }),
      ),
    ).toBe('b.jpg');
  });

  it('passes over a bigger spender that has no creative', () => {
    expect(
      coverFor(
        null,
        [ad('a', null), ad('b', 'b.jpg')],
        lifetime({ a: [900, '2026-01-02'], b: [1, '2026-01-02'] }),
      ),
    ).toBe('b.jpg');
  });

  it('breaks a tie by the oldest Ad, then the id, as the sync does', () => {
    expect(
      coverFor(
        null,
        [
          ad('b', 'b.jpg', '2026-01-02T00:00:00Z'),
          ad('a', 'a.jpg', '2026-01-03T00:00:00Z'),
        ],
        new Map(),
      ),
    ).toBe('b.jpg');
    expect(
      coverFor(null, [ad('b', 'b.jpg'), ad('a', 'a.jpg')], new Map()),
    ).toBe('a.jpg');
  });

  it('is null when no Ad has a creative', () => {
    expect(coverFor(null, [ad('a', null)], new Map())).toBeNull();
    expect(coverFor(null, [], new Map())).toBeNull();
  });
});

describe('endedAtFor', () => {
  const now = new Date('2026-09-24T12:00:00Z');

  it('is null for a Campaign that has not ended', () => {
    expect(
      endedAtFor(
        { status: 'paused', endsAt: new Date('2026-09-01T00:00:00Z') },
        [],
        new Map(),
        now,
      ),
    ).toBeNull();
  });

  it('is the scheduled end once it has passed', () => {
    const endsAt = new Date('2026-09-01T00:00:00Z');
    expect(
      endedAtFor(
        { status: 'ended', endsAt },
        [ad('a', null)],
        lifetime({ a: [100, '2026-09-20'] }),
        now,
      ),
    ).toEqual(endsAt);
  });

  it('is the last day any Ad reported, without a past scheduled end', () => {
    const ads = [ad('a', null), ad('b', null)];
    const figures = lifetime({
      a: [100, '2026-09-03'],
      b: [100, '2026-09-10'],
    });

    expect(
      endedAtFor({ status: 'ended', endsAt: null }, ads, figures, now),
    ).toEqual(new Date('2026-09-10T00:00:00Z'));
    // Deleted before a scheduled end that never came.
    expect(
      endedAtFor(
        { status: 'ended', endsAt: new Date('2026-12-01T00:00:00Z') },
        ads,
        figures,
        now,
      ),
    ).toEqual(new Date('2026-09-10T00:00:00Z'));
  });

  it('is null for an Ended Campaign that never reported a figure', () => {
    expect(
      endedAtFor(
        { status: 'ended', endsAt: null },
        [ad('a', null)],
        new Map(),
        now,
      ),
    ).toBeNull();
  });
});
