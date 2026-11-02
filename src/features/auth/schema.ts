import { z } from 'zod';

// Mirrors supabase/config.toml: minimum_password_length = 8, password_requirements = "letters_digits".
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_HINT = 'At least 8 characters, with letters and numbers.';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, 'Use at least 8 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

export const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code');

export const signInSchema = z.object({
  email: emailSchema,
  // Sign-in only checks presence: older passwords are verified by the server, not the client.
  password: z.string().min(1, 'Enter your password'),
});

export const signUpSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords don’t match',
    path: ['confirmPassword'],
  });

export const verifyEmailSchema = z.object({ code: codeSchema });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetCodeSchema = z.object({ code: codeSchema });

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords don’t match',
    path: ['confirmPassword'],
  });

export type SignInValues = z.infer<typeof signInSchema>;
export type SignUpValues = z.infer<typeof signUpSchema>;
export type VerifyEmailValues = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetCodeValues = z.infer<typeof resetCodeSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
