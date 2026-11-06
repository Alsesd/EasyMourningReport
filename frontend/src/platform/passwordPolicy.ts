/** Shortest password the server accepts when a password is set or changed (mirrors platform.MinPasswordLength). */
export const MIN_PASSWORD_LENGTH = 8;

/** The rule shown next to every password field. */
export const PASSWORD_RULE = "Щонайменше 8 символів: малі й великі літери та цифри.";

/**
 * Whether a new password satisfies the rules: at least 8 characters with a lowercase letter, an uppercase
 * letter and a digit, in any alphabet (mirrors platform.PasswordProblem; the server checks again).
 */
export function isAcceptablePassword(pw: string): boolean {
  return [...pw].length >= MIN_PASSWORD_LENGTH && /\p{Ll}/u.test(pw) && /\p{Lu}/u.test(pw) && /\p{Nd}/u.test(pw);
}
