import type { User } from "./src/types.js";
import type { WeeklyWinner } from "./src/winners.js";
import { computeBadges, computeGroupAwards, NO_AWARDS, type GroupAwards } from "./src/achievements.js";
import {
  AWARD_BASELINE_KEY,
  NOTIFICATIONS_KEEP_DAYS,
  baselineAwards,
  grantAwards,
  listAwardLedger,
  pruneNotifications,
  type NewAward
} from "./db.js";

/* ---------- Badge and achievement notifications ----------
 *
 * Badges are not stored anywhere: they are worked out from a member's stats
 * (see computeBadges). To notice a *new* one, the server compares what a member
 * holds now with a ledger of what they have already been told about
 * (user_awards), after every sync.
 *
 *  - Each award is announced once. Losing and regaining a group badge such as
 *    "Most improved" doesn't announce it again.
 *  - A member's first pass only records what they already hold, silently
 *    (the '_baseline' row). That is what stops everyone being flooded the day
 *    this ships, and what stops a new member being congratulated for the
 *    badges they walked in with.
 */

const shortDate = (isoDay: string) =>
  new Date(`${isoDay}T00:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Everything `user` currently holds, as awards.
function currentAwards(user: User, group: GroupAwards, winners: WeeklyWinner[]): NewAward[] {
  const awards: NewAward[] = [];

  for (const badge of computeBadges(user, group)) {
    if (!badge.earned) continue;
    // The contest-tier badge keeps one id while its label climbs through the
    // tiers; each tier is its own award.
    const key = badge.id === "contest-tier" ? `badge:contest-tier:${badge.label}` : `badge:${badge.id}`;
    awards.push({ key, type: "badge", title: `New badge: ${badge.label}`, body: badge.description });
  }

  // Weekly champion is the "achievement": one award per week won.
  for (const win of winners) {
    if (win.userId !== user.id) continue;
    awards.push({
      key: `winner:${win.weekStart}`,
      type: "achievement",
      title: "Weekly champion",
      body: `You solved the most problems in the week of ${shortDate(win.weekStart)} (+${win.gained}).`
    });
  }

  return awards;
}

// Called for a member who has just joined: what they already hold is
// background, not news. `board` is everyone including the new member (from
// listUsers), so group badges they hold on day one are recorded too.
export async function baselineNewMember(user: User, board: User[] = []): Promise<void> {
  const group = board.length > 0 ? computeGroupAwards(board, Date.now()) : NO_AWARDS;
  await baselineAwards(user.id, currentAwards(user, group, []).map((a) => a.key));
}

// Compares every member's current badges and weekly wins with the ledger and
// notifies them of anything new. `users` must come from listUsers() (so each
// has joinOrder) and carry fresh stats.
export async function notifyNewAwards(users: User[], winners: WeeklyWinner[], nowMs: number = Date.now()): Promise<void> {
  if (users.length === 0) return;

  const group = computeGroupAwards(users, nowMs);
  const ledger = await listAwardLedger();

  for (const user of users) {
    try {
      const awards = currentAwards(user, group, winners);
      const known = ledger.get(user.id);

      // First time we look at this member: record, don't announce.
      if (!known || !known.has(AWARD_BASELINE_KEY)) {
        await baselineAwards(user.id, awards.map((a) => a.key));
        continue;
      }

      const fresh = awards.filter((a) => !known.has(a.key));
      if (fresh.length > 0) await grantAwards(user.id, fresh);
    } catch (err: any) {
      // One member's failure (e.g. removed mid-sync) must not stop the rest.
      console.warn(`[Notifications] Skipped ${user.leetcodeUsername}: ${err.message}`);
    }
  }

  const cutoff = new Date(nowMs - NOTIFICATIONS_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await pruneNotifications(cutoff).catch(() => {});
}
