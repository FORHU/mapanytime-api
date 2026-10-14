/**
 * `Users.name` — the display name Better Auth requires on every user (#122).
 *
 * First and last name when there are any, else the email's local part, so it
 * is never empty. Mirrors the backfill in the `better_auth_core` migration;
 * keep the two in step.
 */
export function displayName(user: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const full = [user.firstName, user.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  return full || user.email.split('@')[0];
}
