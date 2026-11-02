import {
  PASSWORD_HINT,
  PASSWORD_MIN_LENGTH,
  codeSchema,
  emailSchema,
  forgotPasswordSchema,
  passwordSchema,
  resetCodeSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  verifyEmailSchema,
} from '../schema';

describe('auth schema', () => {
  it('requires a minimum password length of 8 and exposes a hint', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(typeof PASSWORD_HINT).toBe('string');
    expect(PASSWORD_HINT.length).toBeGreaterThan(0);
  });

  describe('emailSchema', () => {
    it('trims and lowercases a valid email', () => {
      expect(emailSchema.parse('  Archan@Example.COM  ')).toBe('archan@example.com');
    });

    it.each(['', 'not-an-email', 'a@', '@b.com'])('rejects %p', (value) => {
      expect(emailSchema.safeParse(value).success).toBe(false);
    });
  });

  describe('passwordSchema', () => {
    it('accepts exactly 8 characters with a letter and a digit', () => {
      expect(passwordSchema.safeParse('abcdefg1').success).toBe(true);
    });

    it('rejects 7 characters even with a letter and a digit', () => {
      expect(passwordSchema.safeParse('abcdef1').success).toBe(false);
    });

    it('rejects letters only', () => {
      expect(passwordSchema.safeParse('abcdefgh').success).toBe(false);
    });

    it('rejects digits only', () => {
      expect(passwordSchema.safeParse('12345678').success).toBe(false);
    });

    it('rejects empty', () => {
      expect(passwordSchema.safeParse('').success).toBe(false);
    });

    it('accepts long passwords with symbols', () => {
      expect(passwordSchema.safeParse('Correct-horse-9-battery').success).toBe(true);
    });
  });

  describe('codeSchema', () => {
    it('accepts 6 digits', () => {
      expect(codeSchema.parse('123456')).toBe('123456');
    });

    it('trims surrounding whitespace', () => {
      expect(codeSchema.parse('  123456 ')).toBe('123456');
    });

    it.each(['', '12345', '1234567', '12345a', '12 456'])('rejects %p', (value) => {
      expect(codeSchema.safeParse(value).success).toBe(false);
    });
  });

  describe('signInSchema', () => {
    it('accepts any non-empty password (no strength rules at sign-in)', () => {
      const result = signInSchema.safeParse({ email: 'A@b.com', password: 'x' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.email).toBe('a@b.com');
    });

    it('rejects an empty password', () => {
      expect(signInSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
    });

    it('rejects an invalid email', () => {
      expect(signInSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    });
  });

  describe('signUpSchema', () => {
    const valid = { email: 'a@b.com', password: 'abcdefg1', confirmPassword: 'abcdefg1' };

    it('accepts matching, valid input', () => {
      expect(signUpSchema.safeParse(valid).success).toBe(true);
    });

    it('reports a mismatch on the confirmPassword path', () => {
      const result = signUpSchema.safeParse({ ...valid, confirmPassword: 'abcdefg2' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.join('.') === 'confirmPassword')).toBe(true);
      }
    });

    it('rejects a weak password', () => {
      const result = signUpSchema.safeParse({
        ...valid,
        password: 'short1',
        confirmPassword: 'short1',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === 'password')).toBe(true);
      }
    });
  });

  describe('code and email wrappers', () => {
    it('verifyEmailSchema validates the code', () => {
      expect(verifyEmailSchema.safeParse({ code: '123456' }).success).toBe(true);
      expect(verifyEmailSchema.safeParse({ code: '12' }).success).toBe(false);
    });

    it('resetCodeSchema validates the code', () => {
      expect(resetCodeSchema.safeParse({ code: '123456' }).success).toBe(true);
      expect(resetCodeSchema.safeParse({ code: 'abcdef' }).success).toBe(false);
    });

    it('forgotPasswordSchema validates the email', () => {
      expect(forgotPasswordSchema.safeParse({ email: 'a@b.com' }).success).toBe(true);
      expect(forgotPasswordSchema.safeParse({ email: 'nope' }).success).toBe(false);
    });
  });

  describe('resetPasswordSchema', () => {
    it('accepts matching valid passwords', () => {
      expect(
        resetPasswordSchema.safeParse({ password: 'abcdefg1', confirmPassword: 'abcdefg1' })
          .success,
      ).toBe(true);
    });

    it('reports a mismatch on confirmPassword', () => {
      const result = resetPasswordSchema.safeParse({
        password: 'abcdefg1',
        confirmPassword: 'abcdefg2',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.join('.') === 'confirmPassword')).toBe(true);
      }
    });

    it('rejects a weak new password', () => {
      expect(
        resetPasswordSchema.safeParse({ password: 'abcdefgh', confirmPassword: 'abcdefgh' })
          .success,
      ).toBe(false);
    });
  });
});
