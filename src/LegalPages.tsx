import { useEffect, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import SiteFooter from "./SiteFooter.js";
import { LEGAL, RETENTION, type LegalPageId } from "./legal.js";

// The text below describes what the code does today (see db/schema.sql, the
// sync code in server.ts and the sign-in code in oauth.ts). If a change adds a
// new kind of personal data, a new third party, a new cookie or a new retention
// period, update the matching section here and bump LEGAL.effectiveDate.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";
const linkClass = `font-medium text-teal-300 underline decoration-teal-300/30 underline-offset-4 hover:decoration-teal-300 ${focusRing}`;

type SectionDef = { id: string; title: string; body: ReactNode };

/* ---------- small building blocks ---------- */

function Ul({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-mist-500">{children}</ul>;
}

function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-strong">{children}</strong>;
}

function Mail() {
  return (
    <a href={`mailto:${LEGAL.contactEmail}`} className={linkClass}>
      {LEGAL.contactEmail}
    </a>
  );
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/* ---------- Privacy Policy ---------- */

const PRIVACY: SectionDef[] = [
  {
    id: "who",
    title: "Who is responsible",
    body: (
      <>
        <p>
          {LEGAL.serviceName} is run by <B>{LEGAL.operatorName}</B> ("we", "us"). We decide why and how your personal data is
          used, which makes us the "controller" under laws such as the GDPR and Morocco's Law 09-08.
        </p>
        <p>
          Questions or requests about your data: <Mail />.
        </p>
      </>
    )
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <>
        <Ul>
          <li>
            <B>Account data.</B> The username you choose, a display name (Google or GitHub suggests one; you can change it),
            the email address Google or GitHub has verified, and that provider's stable ID for your account. Accounts created
            before sign-in with Google or GitHub existed may instead have a password, which we store only as a salted hash. We
            never receive your Google or GitHub password and we do not store the access tokens they issue.
          </li>
          <li>
            <B>Profile details you choose to add.</B> School, a short bio, links to your GitHub, LinkedIn or website, and your
            privacy settings.
          </li>
          <li>
            <B>Coding-platform data.</B> When you link LeetCode, Codeforces or CodinGame, the handle you give us and the
            public stats we read from that platform: problems solved (LeetCode also by difficulty), contest ratings and
            contests attended, streaks, rank or level, and your LeetCode avatar image address. We keep the current values and
            one snapshot per day so we can draw progress charts and weekly rankings. We read public profile pages only; we
            never ask for your password on those sites.
          </li>
          <li>
            <B>Ownership proofs.</B> To prove an account is yours we show you a one-time code to paste into your public
            profile on that platform, then read it back. The request expires after 30 minutes.
          </li>
          <li>
            <B>Notifications and awards.</B> Badges you earned, weekly wins, and messages sent to you by administrators.
          </li>
          <li>
            <B>Feedback.</B> What you write in the Feedback form, its category, and the page you were on. If you are signed
            in, it carries your name; otherwise it is anonymous. We do not store your IP address with it.
          </li>
          <li>
            <B>Technical data.</B> Your IP address and basic request details. We use them to limit abuse (rate limits and
            lockouts) and to write security logs, which can also name the account involved. A session cookie keeps you signed in (see "Cookies and browser storage").
          </li>
        </Ul>
        <p>
          We do not run advertising or analytics trackers, and we do not collect payment details, precise location, or
          anything from your device beyond the above.
        </p>
      </>
    )
  },
  {
    id: "use",
    title: "How we use it, and why",
    body: (
      <>
        <Ul>
          <li>
            <B>To run the service you asked for:</B> create and secure your account, fetch your stats, compute rankings,
            streaks, badges and weekly winners, and show them to other members. (Legal basis: performing our agreement with
            you.)
          </li>
          <li>
            <B>To keep the service safe:</B> rate limiting, account lockouts, fraud and abuse prevention, security logs and
            debugging. (Legal basis: our legitimate interest in a secure service.)
          </li>
          <li>
            <B>To respond to you:</B> feedback, privacy requests and account help. (Legal basis: legitimate interests, and
            legal obligations where they apply.)
          </li>
          <li>
            <B>Your email address</B> identifies your account, prevents duplicate accounts, and lets us contact you about
            your account or this policy. We do not send marketing email.
          </li>
        </Ul>
        <p>
          We do not sell your personal data, share it with advertisers, or use it to make decisions that have legal or
          similarly significant effects on you. Rankings and badges are calculated automatically, but they are for fun and
          have no such effect.
        </p>
      </>
    )
  },
  {
    id: "visible",
    title: "Who can see your data",
    body: (
      <>
        <Ul>
          <li>
            <B>Other members.</B> The leaderboard is only available to signed-in members. They can see your display name,
            avatar, school, stats, ranks and badges, and on your profile page your bio, links and platform stats.
          </li>
          <li>
            <B>Never shown to other members:</B> your email address, your password hash and your sign-in provider ID.
          </li>
          <li>
            <B>Hiding.</B> You can hide your LeetCode stats on your profile, and hide a linked platform account. These are
            display settings: hidden data still counts toward the boards and group statistics, and administrators can still
            see it.
          </li>
          <li>
            <B>Administrators.</B> The people who run the service can see member data to operate it: sync status, feedback
            (with the author's name when signed in), and messages they send. Whoever operates the database can technically
            read everything stored there, including email addresses.
          </li>
        </Ul>
      </>
    )
  },
  {
    id: "third-parties",
    title: "Who else handles data",
    body: (
      <>
        <Ul>
          <li>
            <B>Hosting.</B> The site and its API run on Vercel, which serves requests and may keep access logs that include
            IP addresses.
          </li>
          <li>
            <B>Database.</B> Account and stats data is stored with Turso (a hosted SQLite database).
          </li>
          <li>
            <B>Google and GitHub (sign-in).</B> If you choose to sign in with them, they tell us your verified email,
            account ID and name, and they learn that you use {LEGAL.serviceName}. We ask Google for the{" "}
            <code className="font-mono text-[13px] text-mist-100">openid email profile</code> scopes and GitHub for{" "}
            <code className="font-mono text-[13px] text-mist-100">read:user user:email</code>. Their own privacy policies
            apply to their side.
          </li>
          <li>
            <B>LeetCode, Codeforces and CodinGame.</B> To read your public stats we send your handle to the platform (to
            LeetCode, to Codeforces' public API, and to CodinGame's website). If LeetCode does not answer, we fall back to
            two public LeetCode stats APIs run by other people (alfa-leetcode-api on onrender.com and leetcode-stats-api on
            herokuapp.com). They receive the handle and our server's IP address, not your name or email.
          </li>
          <li>
            <B>Avatar images.</B> A member's avatar is an image hosted by LeetCode or Codeforces. When a page shows it, your
            browser requests it directly from that platform's image server, which therefore receives your IP address and
            browser details.
          </li>
          <li>
            <B>Google Fonts.</B> Pages load their typefaces from Google Fonts. Your browser requests them directly from
            Google, so Google receives your IP address and browser details when a page loads.
          </li>
        </Ul>
        <p>
          <B>Google user data.</B> We use the information we receive from Google only to create your account and sign you
          in. We do not use it for advertising, we do not sell it, and we do not share it except with the hosting and
          database providers above, which process it for us. {LEGAL.serviceName}'s use and transfer of information received
          from Google APIs adheres to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <p>
          Our providers may process data in countries other than yours, including the United States. Where the law requires
          it, we rely on safeguards such as the standard contractual clauses our providers offer. We may also disclose data
          when the law requires it or to protect the safety and rights of members or the service.
        </p>
      </>
    )
  },
  {
    id: "cookies",
    title: "Cookies and browser storage",
    body: (
      <>
        <Ul>
          <li>
            <B>session</B> cookie: keeps you signed in. It is HTTP-only and lasts up to {RETENTION.sessionDays} days.
          </li>
          <li>
            <B>oauth_state</B>, <B>oauth_signup</B> and <B>pwreset</B> cookies: short-lived, used only while you sign in with
            Google or GitHub, choose a username, or recover an account.
          </li>
          <li>
            <B>localStorage:</B> your theme choice and the members you pinned.
          </li>
          <li>
            <B>sessionStorage:</B> remembers for this tab that you already passed the landing page.
          </li>
        </Ul>
        <p>
          We use no advertising or analytics cookies. Everything above is either strictly necessary to run the service or
          stores a preference you set.
        </p>
      </>
    )
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <>
        <Ul>
          <li>
            <B>Account and profile:</B> until you delete your account.
          </li>
          <li>
            <B>Daily stat snapshots:</B> the newest {RETENTION.historyDays} days.
          </li>
          <li>
            <B>Notifications:</B> removed after {RETENTION.notificationDays} days. Dismissing one only hides it from you until
            then.
          </li>
          <li>
            <B>Sign-in, linking and recovery requests:</B> expire within 30 minutes.
          </li>
          <li>
            <B>Rate-limit counters (IP based):</B> expire when their time window ends, at most an hour.
          </li>
          <li>
            <B>Server logs:</B> kept by our hosting provider under its own schedule; they include IP addresses and are used
            for security and troubleshooting.
          </li>
          <li>
            <B>Feedback:</B> kept for the administrators. If you delete your account, your feedback stays but is no longer
            linked to you.
          </li>
          <li>
            <B>Hall of fame:</B> a deleted member's weekly wins are dropped from the archive the next time the boards
            refresh.
          </li>
          <li>
            <B>Backups:</B> our database provider may keep backups for a limited time, so deleted data can remain in them
            until they rotate out.
          </li>
        </Ul>
      </>
    )
  },
  {
    id: "rights",
    title: "Your rights and choices",
    body: (
      <>
        <Ul>
          <li>
            <B>See and correct your data.</B> Account settings lets you change your display name, school, bio, links and
            privacy settings.
          </li>
          <li>
            <B>Delete your account.</B> Account settings has a Delete account button. It permanently removes your profile,
            stats, history, notifications, linked platform accounts and sign-in connections.
          </li>
          <li>
            <B>Unlink a platform</B> (LeetCode, Codeforces or CodinGame) at any time from Account settings. This removes that
            platform's stats and history; the rest of your account stays.
          </li>
          <li>
            <B>Get a copy of your data.</B> There is no self-service download yet. Email <Mail /> and we will send you a copy
            in a common, machine-readable format.
          </li>
          <li>
            <B>Revoke sign-in access</B> from your Google or GitHub account settings whenever you like.
          </li>
        </Ul>
        <p>
          Depending on where you live (for example the EU, EEA or UK), you may also have the right to restrict or object to
          processing, to data portability, and to withdraw consent you gave. To use any right, email <Mail />. We may ask you
          to write from the address on your account or to sign in so we know it is you. If you are unhappy with our answer,
          you can complain to your local data-protection authority, such as the CNDP in Morocco.
        </p>
      </>
    )
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>
        We use HTTPS, salted password hashing, HTTP-only cookies, rate limits and account lockouts, and we audit our
        dependencies. No online service is perfectly secure. If a breach affects you, we will tell you and the authorities as
        the law requires.
      </p>
    )
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        {LEGAL.serviceName} is not meant for anyone under 13, or under the higher minimum age at which your country lets you
        agree to this kind of data processing. If you think a child has signed up, email <Mail /> and we will delete the
        account.
      </p>
    )
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        When we change this policy in a meaningful way we will update the date at the top and, where practical, tell members
        through the site before the change takes effect.
      </p>
    )
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        <B>{LEGAL.operatorName}</B>
        <br />
        <Mail />
      </p>
    )
  }
];

/* ---------- Terms of Service ---------- */

const TERMS: SectionDef[] = [
  {
    id: "agreement",
    title: "Agreeing to these terms",
    body: (
      <>
        <p>
          By creating an account or using {LEGAL.serviceName} ("the service") you agree to these terms and to our{" "}
          <a href="/privacy" className={linkClass}>
            Privacy Policy
          </a>
          . If you do not agree, please do not use the service.
        </p>
        <p>
          You must be at least 13, or older if your country requires it for you to enter this kind of agreement. The service
          is run by <B>{LEGAL.operatorName}</B> ("we", "us").
        </p>
      </>
    )
  },
  {
    id: "service",
    title: "What the service is",
    body: (
      <>
        <p>
          {LEGAL.serviceName} is a competitive-programming leaderboard for friends, classes and clubs. It reads public
          statistics from LeetCode, Codeforces and CodinGame and ranks members on live boards.
        </p>
        <p>
          It is an independent project. It is <B>not affiliated with, endorsed by or sponsored by</B> LeetCode, Codeforces,
          CodinGame, Google or GitHub. Their names and marks belong to their owners and are used only to say which service a
          number comes from.
        </p>
      </>
    )
  },
  {
    id: "accounts",
    title: "Your account",
    body: (
      <Ul>
        <li>Give accurate information and keep your account secure. You are responsible for what happens under it.</li>
        <li>One person, one account. Do not share your account or create several to gain an advantage.</li>
        <li>
          Link only platform accounts that are yours. We check ownership with a one-time code in your public profile, and you
          must not try to get around that check.
        </li>
        <li>You can delete your account at any time from Account settings.</li>
      </Ul>
    )
  },
  {
    id: "content",
    title: "What you share",
    body: (
      <>
        <p>
          Your display name, school, bio, links and stats are shown to other signed-in members. You keep ownership of what you
          write. You give us permission to store and display it, only as needed to run the service.
        </p>
        <p>
          Do not post anything unlawful, hateful, harassing, sexually explicit or misleading, impersonate another person, or
          add links to harmful or deceptive sites. We may edit or remove content that breaks these rules.
        </p>
      </>
    )
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p>Do not:</p>
        <Ul>
          <li>cheat, falsify or manipulate stats, ranks or badges;</li>
          <li>scrape the service, or send automated or excessive requests, or bypass rate limits and lockouts;</li>
          <li>probe for vulnerabilities, attack or overload the service, or try to access other members' data;</li>
          <li>create accounts automatically or in bulk;</li>
          <li>use the service to break the rules of LeetCode, Codeforces, CodinGame, Google or GitHub, or any law.</li>
        </Ul>
        <p>
          Found a security issue? Please tell us at <Mail /> instead of exploiting it.
        </p>
      </>
    )
  },
  {
    id: "data",
    title: "Third-party data and accuracy",
    body: (
      <p>
        Statistics come from third-party platforms. They are refreshed when members use the site and the data is more than
        about 30 minutes old, so there is no fixed schedule and a quiet period can leave numbers older than that. They can be
        delayed, incomplete or wrong, and a platform may change or block access at any time. Rankings, badges and winners are
        for fun and motivation, not an official record, and should not be relied on for grading, hiring or similar decisions.
      </p>
    )
  },
  {
    id: "suspension",
    title: "Suspension and ending your access",
    body: (
      <p>
        We may suspend or remove an account, or content, that breaks these terms or puts the service or other members at
        risk. If you think we got it wrong, email <Mail />. You may stop using the service and delete your account whenever
        you want.
      </p>
    )
  },
  {
    id: "availability",
    title: "Availability and changes",
    body: (
      <p>
        The service is free and run on a best-effort basis. It may be slow, unavailable or change without notice, and we may
        add, change or remove features, or shut it down.
      </p>
    )
  },
  {
    id: "liability",
    title: "Disclaimers and liability",
    body: (
      <>
        <p>
          The service is provided "as is" and "as available", without warranties of any kind. To the fullest extent the law
          allows, we are not liable for indirect or consequential losses, lost data or lost opportunities arising from using
          the service, and our total liability for any claim is limited to the amount you paid us, which for a free service
          is zero.
        </p>
        <p>
          Nothing in these terms excludes or limits liability that cannot be excluded by law, or consumer rights you have
          under the law where you live.
        </p>
      </>
    )
  },
  {
    id: "source",
    title: "Source code",
    body: (
      <p>
        The code behind {LEGAL.serviceName} is published at{" "}
        <a href={LEGAL.sourceUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
          GitHub
        </a>
        . Using that code is governed by the license in that repository, not by these terms, which cover your use of the
        hosted service.
      </p>
    )
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        We may update these terms. When the change is meaningful we will update the date above and, where practical, tell
        members before it takes effect. Using the service after that means you accept the new terms.
      </p>
    )
  },
  {
    id: "law",
    title: "Governing law and contact",
    body: (
      <>
        <p>
          These terms are governed by the law of {LEGAL.governingLaw}, without affecting any mandatory consumer protections
          where you live.
        </p>
        <p>
          <B>{LEGAL.operatorName}</B>
          <br />
          <Mail />
        </p>
      </>
    )
  }
];

/* ---------- page ---------- */

const PAGES: Record<LegalPageId, { title: string; command: string; blurb: string; sections: SectionDef[] }> = {
  privacy: {
    title: "Privacy Policy",
    command: "cat privacy.md",
    blurb: "What we collect, why, who sees it, and the choices you have.",
    sections: PRIVACY
  },
  terms: {
    title: "Terms of Service",
    command: "cat terms.md",
    blurb: "The ground rules for using Leeterboard.",
    sections: TERMS
  }
};

export default function LegalPage({ page }: { page: LegalPageId }) {
  const { title, command, blurb, sections } = PAGES[page];

  useEffect(() => {
    document.title = `${title} · ${LEGAL.serviceName}`;
  }, [title]);

  return (
    <main className="min-h-dvh">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
        <header className="flex items-center justify-between gap-4">
          <a href="/" className={`font-logo text-lg font-semibold tracking-tight text-strong ${focusRing}`}>
            {LEGAL.serviceName}
          </a>
          <a href="/" className={`inline-flex items-center gap-1.5 text-sm text-mist-400 transition hover:text-strong ${focusRing}`}>
            <ArrowLeft size={16} aria-hidden="true" />
            Back to {LEGAL.serviceName}
          </a>
        </header>

        <div className="mt-12">
          <div className="mb-3 flex items-center gap-2 font-mono text-xs text-mist-500" aria-hidden="true">
            <span className="font-bold text-emerald-400">&#8250;</span>
            <span className="truncate">{command}</span>
          </div>
          <h1 className="font-logo text-3xl font-bold tracking-tight text-strong md:text-5xl">{title}</h1>
          <p className="mt-2 text-base text-mist-400">{blurb}</p>
          <p className="mt-4 text-sm text-mist-500">
            Last updated <time dateTime={LEGAL.effectiveDate}>{formatDate(LEGAL.effectiveDate)}</time>
          </p>
        </div>

        <nav aria-label="On this page" className="mt-8 rounded-2xl border border-line bg-ink-900/60 p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-mist-500">On this page</p>
          <ol className="grid list-decimal gap-x-8 gap-y-1.5 pl-5 text-sm text-mist-400 marker:text-mist-500 sm:grid-cols-2">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={`transition hover:text-strong ${focusRing}`}>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="mt-10 space-y-10">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-6">
              <h2 id={`${s.id}-title`} className="font-logo text-xl font-semibold tracking-tight text-strong">
                <span className="mr-2 font-mono text-sm font-normal text-mist-500">{String(i + 1).padStart(2, "0")}</span>
                {s.title}
              </h2>
              <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-mist-400">{s.body}</div>
            </section>
          ))}
        </article>

        <SiteFooter className="mt-14" />
      </div>
    </main>
  );
}
