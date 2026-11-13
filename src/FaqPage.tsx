import { DocumentPage, B, Mail, Ul, linkClass, type SectionDef } from "./LegalPages.js";
import { FAQ_PATH, FAQ_UPDATED, POLL_SECONDS, SYNC_MINUTES } from "./faq.js";
import { LEGAL, LEGAL_PATHS, RETENTION } from "./legal.js";
import { RATING_TIERS } from "./tiers.js";

// Everything below describes what the code does today. The numbers come from
// shared constants (tiers.ts, legal.ts, faq.ts) where they exist, so they can't
// drift from the app. If a change alters how ranking, progress, tiers, badges or
// syncing work, update the matching section and bump FAQ_UPDATED in faq.ts.

const TH = "border-b border-line px-3 py-2 text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-mist-500";
const TD = "border-b border-line/60 px-3 py-2 align-top";

function Table({ head, rows, label }: { head: string[]; rows: string[][]; label: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[28rem] text-sm" aria-label={label}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className={`${TD} text-left font-medium text-strong`}>
                    {cell}
                  </th>
                ) : (
                  <td key={i} className={TD}>
                    {cell}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SECTIONS: SectionDef[] = [
  {
    id: "overview",
    title: "What Leeterboard measures",
    body: (
      <>
        <p>
          Leeterboard has no invented points. Everything is a real number read from a member's public profile on a coding
          platform: problems solved, contest rating, streaks. We rank people by those numbers and track how they change over
          time.
        </p>
        <p>
          <B>LeetCode</B> is the main board. <B>Codeforces</B> and <B>CodinGame</B> are optional extras a member can link in
          Account settings, and each has its own board.
        </p>
      </>
    )
  },
  {
    id: "ranking",
    title: "How the ranking works",
    body: (
      <>
        <p>The LeetCode board can be sorted three ways. Ties are always broken by a second number, so two people never share a rank by accident.</p>
        <Table
          label="Leaderboard sort orders"
          head={["Sort", "Ranked by", "Tie-break"]}
          rows={[
            ["All time", "Total problems solved on LeetCode", "Progress this week"],
            ["This week", "Problems solved since Monday 00:00 UTC", "Total problems solved"],
            ["Contest rating", "LeetCode contest rating, highest first. Unrated members come after rated ones", "Total problems solved"]
          ]}
        />
        <p>
          Codeforces and CodinGame boards work the same way, with their own numbers (see "Linked platforms" below). Only members
          who linked a LeetCode account get a rank on the LeetCode board. A small arrow next to a name shows how many places
          they have climbed or dropped since last week, and "NEW" marks someone who just joined.
        </p>
      </>
    )
  },
  {
    id: "progress",
    title: "Weekly and monthly progress",
    body: (
      <>
        <Ul>
          <li>
            <B>Weeks run Monday to Sunday, UTC.</B> The round closes at Monday 00:00 UTC, when the weekly counter goes back to
            zero. The clock on the leaderboard counts down to it.
          </li>
          <li>
            <B>Only new solves count.</B> When you join, we record how many problems you had already solved (your baseline).
            Progress is counted on top of that, starting the day you joined, so nobody gets credit for the past.
          </li>
          <li>
            <B>Joining mid-week</B> is fine: your first week counts from the day you joined to that Sunday.
          </li>
          <li>
            <B>Monthly progress</B> is what you solved in the last 30 days.
          </li>
          <li>
            <B>Weekly winners.</B> Each Monday the member with the most solves in the week that just ended becomes the weekly
            winner. Winners are archived, so the hall of fame keeps them long after the daily history below is trimmed.
          </li>
        </Ul>
        <p>
          Charts are drawn from one snapshot per day. We keep the newest {RETENTION.historyDays} days per member. Where a gap
          separates two snapshots, the difference is spread evenly over the missing days.
        </p>
      </>
    )
  },
  {
    id: "tiers",
    title: "Tiers and avatar frames",
    body: (
      <>
        <p>
          A member's contest rating decides their tier. The tier sets the colour of their rating and the frame around their
          avatar, from a plain ring up to a glowing, turning frame for Grandmasters. Members who have never entered a contest
          are unrated and have no tier.
        </p>
        <Table
          label="Rating tiers"
          head={["Tier", "LeetCode rating from"]}
          rows={[...RATING_TIERS].reverse().map((t) => [t.name, t.min.toLocaleString("en-US")])}
        />
        <p>
          Codeforces rank titles (Newbie up to Legendary Grandmaster) share the same colours and frames. CodinGame has levels
          instead of ratings, so a frame steps up every ten levels: 10+ is Pupil, 20+ Specialist, and so on up to 60+.
        </p>
      </>
    )
  },
  {
    id: "badges",
    title: "Badges",
    body: (
      <>
        <p>Badges are worked out from your data each time, not handed out by hand.</p>
        <Table
          label="Badges"
          head={["Badge", "How to earn it"]}
          rows={[
            ["100 / 500 / 1,000 solved", "Reach that many solved problems on LeetCode"],
            ["First Hard", "Solve your first Hard problem"],
            ["First contest", "Take part in a LeetCode contest"],
            ["Contest tiers", "Rated 1500+, Rated 1700+, Knight (1850+) or Guardian (2150+)"],
            ["7-day streak", "Submit on 7 days in a row on LeetCode"],
            ["Most improved", "The biggest jump in solving pace this month compared with the month before. Needs at least two comparable members and a real amount of solving"],
            ["First on the board", "The earliest member still here. Only shown to the member who holds it"]
          ]}
        />
        <p>
          When you earn a badge or win a week you get a notification (the bell in the header). Members who already held a badge
          when they joined are not congratulated for it.
        </p>
      </>
    )
  },
  {
    id: "platforms",
    title: "Linked platforms",
    body: (
      <>
        <p>
          Each platform reports different things, so "solved" does not mean the same everywhere. A handle can belong to only one
          member, and you prove it is yours by putting a one-time code in your public profile before it is linked.
        </p>
        <Table
          label="What each platform counts"
          head={["Platform", "\"Solved\" means", "Rating", "Ranked by"]}
          rows={[
            ["LeetCode", "Problems solved, split into Easy, Medium and Hard", "Contest rating", "Solved, this week, or rating"],
            ["Codeforces", "Distinct problems solved. Gym contests are not counted", "Codeforces rating and rank title", "Solved, this week, or rating"],
            ["CodinGame", "Total XP (there is no problem count)", "Level", "XP, this week's XP, or level"]
          ]}
        />
      </>
    )
  },
  {
    id: "syncing",
    title: "How often data updates",
    body: (
      <>
        <Ul>
          <li>
            <B>Roughly every {SYNC_MINUTES} minutes.</B> On a server that stays running, everyone is refreshed on that schedule.
            Leeterboard on Vercel has no background job, so the board refreshes itself when someone opens it: if the last sync
            was more than {SYNC_MINUTES} minutes ago, the page asks the server to refresh the members who are out of date.
          </li>
          <li>
            <B>Big boards may take a few visits.</B> A refresh works for a short time budget and carries on with the rest at the
            next visit.
          </li>
          <li>
            <B>Your screen stays current.</B> While the tab is open the board checks for new numbers every {POLL_SECONDS} seconds,
            so you do not need to reload.
          </li>
          <li>
            <B>Why your count can lag.</B> We read public profile data, and the platforms sometimes answer slowly or not at all.
            Codeforces allows about one request every two seconds, and CodinGame has no official API. A member whose data has
            not updated in over a day gets a "stale" tag, which means the fetches are failing rather than that nothing changed.
          </li>
          <li>
            <B>Admins</B> can force a full refresh at any time.
          </li>
        </Ul>
      </>
    )
  },
  {
    id: "faq",
    title: "Common questions",
    body: (
      <>
        <p>
          <B>Do you ever ask for my LeetCode, Codeforces or CodinGame password?</B> No. We only read public profile pages, and
          you prove ownership with a one-time code in your profile. You can remove the code afterwards.
        </p>
        <p>
          <B>My numbers look wrong. What should I do?</B> Wait for the next sync (up to {SYNC_MINUTES} minutes), and check that
          the number shows on your public profile on that platform, because that is where we read it. If it still looks wrong,
          use the Feedback button or write to <Mail />.
        </p>
        <p>
          <B>Can I hide a platform from other members?</B> Yes. In Account settings you can hide a linked platform, or hide your
          LeetCode stats on your profile (you still count on the board). You can also unlink a platform at any time.
        </p>
        <p>
          <B>Can I get my data or delete my account?</B> Yes, both are in Account settings: <B>Download my data</B> saves a JSON
          copy of everything we store about you, and <B>Delete account</B> removes it for good. See the{" "}
          <a href={LEGAL_PATHS.privacy} className={linkClass}>
            Privacy Policy
          </a>{" "}
          for the details.
        </p>
        <p>
          <B>Is the code open source?</B> Yes, it is MIT licensed. Find it on{" "}
          <a href={LEGAL.sourceUrl} className={linkClass} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          .
        </p>
      </>
    )
  }
];

export default function FaqPage() {
  return (
    <DocumentPage
      title="How scoring works"
      command={`cat ${FAQ_PATH.slice(1)}.md`}
      blurb="How ranks, weekly rounds, tiers, badges and syncing work."
      updated={FAQ_UPDATED}
      sections={SECTIONS}
    />
  );
}
