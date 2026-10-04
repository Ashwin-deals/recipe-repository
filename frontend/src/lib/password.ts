// Plain-language password feedback for the sign-up form. The server has the final say
// (length 8 to 128 and a common-password list); this only guides people toward long passwords.

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const COMMON = new Set([
  "password", "password1", "password123", "passw0rd", "12345678", "123456789", "1234567890", "qwertyuiop",
  "qwerty123", "iloveyou", "sunshine", "princess", "football", "baseball", "welcome1", "letmein1", "trustno1",
  "abc12345", "abcd1234", "abcdefgh", "changeme", "admin123", "cartchef", "11111111", "00000000",
]);

export interface Strength {
  /** 0 (too weak or too short) to 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  hint: string;
}

export function passwordStrength(password: string, email = ""): Strength {
  const lower = password.toLowerCase();
  if (!password) return { score: 0, label: "", hint: `Use at least ${PASSWORD_MIN} characters. Longer is stronger.` };
  if (password.length < PASSWORD_MIN) {
    const left = PASSWORD_MIN - password.length;
    return { score: 0, label: "Too short", hint: `${left} more character${left === 1 ? "" : "s"} to go.` };
  }
  if (COMMON.has(lower) || new Set(password).size < 3 || (email && lower === email.split("@")[0]?.toLowerCase())) {
    return { score: 0, label: "Too easy", hint: "That one is easy to guess. Try a few unrelated words together." };
  }
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const words = password.trim().split(/\s+/).length;
  let score = password.length >= 16 ? 3 : password.length >= 12 ? 2 : 1;
  if (kinds >= 3 || words >= 3) score += 1;
  const capped = Math.min(score, 4) as Strength["score"];
  const labels = ["", "Okay", "Good", "Strong", "Very strong"] as const;
  const hints = [
    "",
    "Okay. Adding a few more characters makes it much harder to guess.",
    "Good. A short phrase of three or four words is even better.",
    "Hard to guess.",
    "Hard to guess, and easy for you to remember if it's a phrase.",
  ] as const;
  return { score: capped, label: labels[capped], hint: hints[capped] };
}

const EMAIL_RE = /^[^@\s]{1,64}@[^@\s.]+(\.[^@\s.]+)+$/;

export function emailProblem(email: string): string | null {
  const value = email.trim();
  if (!value) return "Enter your email address.";
  if (value.length > 254 || !EMAIL_RE.test(value)) return "Enter a valid email address, like name@example.com.";
  return null;
}
