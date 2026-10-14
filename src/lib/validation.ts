/** Client-side checks that mirror the API's (`E:\aylo\orza\src\app\api\auth\_lib.ts`) so errors show before a round-trip. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(raw: string): string | null {
  const email = raw.trim();
  if (!email) return 'Please enter your email';
  if (email.length > 254 || !EMAIL_RE.test(email)) return "That doesn't look like an email address";
  return null;
}

export function validateName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Please enter your name';
  if (name.length > 60) return 'Please keep your name under 60 characters';
  return null;
}

export function validateNewPassword(pw: string): string | null {
  if (!pw) return 'Please choose a password';
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 128) return 'Password must be 128 characters or fewer';
  return null;
}

export function validatePassword(pw: string): string | null {
  if (!pw) return 'Please enter your password';
  return null;
}

/** 0–3 rough strength for the sign-up meter. */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < 8) return 0;
  let score = 1;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw)) score++;
  else if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(3, score) as 0 | 1 | 2 | 3;
}
