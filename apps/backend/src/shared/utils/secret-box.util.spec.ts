import {
  SecretSealingError,
  deriveKey,
  parseSealingKey,
  seal,
  unseal,
} from './secret-box.util';

const KEY_A = parseSealingKey('a'.repeat(64));
const KEY_B = parseSealingKey('b'.repeat(64));

describe('secret box', () => {
  describe('parseSealingKey', () => {
    it('names the variable when it is missing, because a boot failure here is cheaper than a connection that silently stops working', () => {
      expect(() => parseSealingKey(undefined)).toThrow(SecretSealingError);
      expect(() => parseSealingKey(undefined)).toThrow(
        /AD_PLATFORM_ENCRYPTION_KEY/,
      );
    });

    it('rejects a key that is not 32 bytes of hex', () => {
      expect(() => parseSealingKey('too-short')).toThrow(SecretSealingError);
      expect(() => parseSealingKey('z'.repeat(64))).toThrow(SecretSealingError);
    });
  });

  it('opens what it sealed', () => {
    expect(unseal(seal('profile-key-123', KEY_A), KEY_A)).toBe(
      'profile-key-123',
    );
  });

  it('never emits the plaintext, which is the whole point of the column', () => {
    expect(seal('profile-key-123', KEY_A)).not.toContain('profile-key-123');
  });

  it('seals the same secret differently every time, so two stores holding one value do not look alike at rest', () => {
    expect(seal('same', KEY_A)).not.toBe(seal('same', KEY_A));
  });

  it('refuses the wrong key rather than returning garbage', () => {
    expect(() => unseal(seal('secret', KEY_A), KEY_B)).toThrow(
      SecretSealingError,
    );
  });

  it('refuses a tampered value — the reason for GCM rather than CBC', () => {
    const sealed = seal('secret', KEY_A);
    const [version, nonce, tag, ciphertext] = sealed.split('.');
    const flipped = Buffer.from(ciphertext, 'base64url');
    flipped[0] ^= 0xff;
    expect(() =>
      unseal(
        [version, nonce, tag, flipped.toString('base64url')].join('.'),
        KEY_A,
      ),
    ).toThrow(SecretSealingError);
  });

  it('refuses a value that is not sealed at all, including an empty column', () => {
    expect(() => unseal('', KEY_A)).toThrow(SecretSealingError);
    expect(() => unseal('profile-key-123', KEY_A)).toThrow(SecretSealingError);
    expect(() => unseal('v2.a.b.c', KEY_A)).toThrow(SecretSealingError);
  });

  describe('deriveKey', () => {
    it('gives a different key per label, so signing a handoff cannot open a credential', () => {
      expect(deriveKey(KEY_A, 'one')).not.toEqual(deriveKey(KEY_A, 'two'));
    });

    it('is stable, or a handoff issued by one process would not verify in the next', () => {
      expect(deriveKey(KEY_A, 'handoff')).toEqual(deriveKey(KEY_A, 'handoff'));
    });
  });
});
