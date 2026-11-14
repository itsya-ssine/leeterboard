import {
  isBreachedPassword,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH
} from "../../../auth.js";

export async function validatePassword(password: unknown, username: string): Promise<string | null> {
  if (typeof password !== "string") return "Password is required.";
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (password.toLowerCase() === username.toLowerCase()) return "Password can't be the same as your username.";
  if (await isBreachedPassword(password)) {
    return "This password has appeared in a known data breach. Please choose a different, more secure password.";
  }
  return null;
}
