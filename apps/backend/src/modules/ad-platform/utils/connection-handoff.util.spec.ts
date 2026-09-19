import {
  HANDOFF_TTL_MS,
  HandoffError,
  isSafeReturnPath,
  signHandoff,
  verifyHandoff,
  type ConnectionHandoff,
} from './connection-handoff.util';

const KEY = Buffer.alloc(32, 1);
const OTHER_KEY = Buffer.alloc(32, 2);
const NOW = Date.UTC(2026, 5, 1);

const handoff = (
  overrides: Partial<ConnectionHandoff> = {},
): ConnectionHandoff => ({
  organizationId: '11111111-1111-1111-1111-111111111111',
  storeId: '22222222-2222-2222-2222-222222222222',
  platform: 'meta',
  returnPath: '/admin/settings?section=ad-platforms',
  expiresAt: NOW + HANDOFF_TTL_MS,
  ...overrides,
});

describe('connection handoff', () => {
  it('reads back what it signed', () => {
    const original = handoff();
    expect(verifyHandoff(signHandoff(original, KEY), KEY, NOW)).toEqual(
      original,
    );
  });

  it('refuses a note signed with another key — the return trip carries no admin token, so this is the only thing standing in for one', () => {
    expect(() =>
      verifyHandoff(signHandoff(handoff(), OTHER_KEY), KEY, NOW),
    ).toThrow(HandoffError);
  });

  it('refuses a note whose Store was edited after signing', () => {
    const token = signHandoff(handoff(), KEY);
    const [payload, signature] = token.split('.');
    const tampered = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as ConnectionHandoff;
    const forged = Buffer.from(
      JSON.stringify({ ...tampered, storeId: 'someone-elses-store' }),
      'utf8',
    ).toString('base64url');

    expect(() => verifyHandoff(`${forged}.${signature}`, KEY, NOW)).toThrow(
      HandoffError,
    );
  });

  it('refuses a stale note', () => {
    const token = signHandoff(handoff({ expiresAt: NOW + 1000 }), KEY);
    expect(verifyHandoff(token, KEY, NOW).storeId).toBeDefined();
    expect(() => verifyHandoff(token, KEY, NOW + 1001)).toThrow(HandoffError);
  });

  it('refuses a malformed note rather than crashing on the return trip', () => {
    expect(() => verifyHandoff('', KEY, NOW)).toThrow(HandoffError);
    expect(() => verifyHandoff('nodot', KEY, NOW)).toThrow(HandoffError);
    expect(() => verifyHandoff('a.b', KEY, NOW)).toThrow(HandoffError);
  });

  describe('isSafeReturnPath', () => {
    it('accepts a path inside the admin', () => {
      expect(isSafeReturnPath('/admin/settings')).toBe(true);
      expect(isSafeReturnPath('/admin/settings?section=ad-platforms')).toBe(
        true,
      );
    });

    it('refuses anything that could leave our origin, since this value ends up in a Location header', () => {
      expect(isSafeReturnPath('https://evil.example/admin')).toBe(false);
      expect(isSafeReturnPath('//evil.example/admin')).toBe(false);
      expect(isSafeReturnPath('/\\evil.example')).toBe(false);
      expect(isSafeReturnPath('admin/settings')).toBe(false);
      expect(isSafeReturnPath('/admin\nLocation: https://evil.example')).toBe(
        false,
      );
    });
  });

  it('refuses a validly signed note that names an unsafe return path, so a signing bug cannot become an open redirect', () => {
    const token = signHandoff(
      handoff({ returnPath: 'https://evil.example' }),
      KEY,
    );
    expect(() => verifyHandoff(token, KEY, NOW)).toThrow(HandoffError);
  });
});
