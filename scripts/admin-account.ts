/**
 * Out-of-band account recovery for the people running Leeterboard.
 *
 *   npm run admin -- show-id <leetcodeUsername>
 *   npm run admin -- set-password <leetcodeUsername> [--password-stdin]
 *   npm run admin -- approve-reset <leetcodeUsername>
 *
 * Why this exists: admin accounts, and accounts whose LeetCode name stopped
 * resolving, can't be claimed or reset through the website (a recycled
 * LeetCode username must not be enough to take them over). Recovery happens
 * here instead, by someone who controls the database credentials.
 *
 *   show-id        prints the member's internal id, which is what
 *                  ADMIN_USER_IDS expects.
 *   set-password   sets a new password directly (min. 12 characters). Existing
 *                  sessions stop working and any lockout is cleared. The
 *                  password is read from a hidden prompt, or from stdin with
 *                  --password-stdin so it never lands in shell history:
 *                    printf '%s' "$NEW_PW" | npm run admin -- set-password alice --password-stdin
 *   approve-reset  lifts the "name stopped resolving" freeze so the member can
 *                  claim/reset through the website again. Do this only after
 *                  you have checked the person really is the original owner.
 *
 * Uses TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from the environment or .env
 * (local.db when unset). A remote database needs --confirm-remote, the same
 * safety catch `npm run db:migrate` has. set-password also needs JWT_SECRET,
 * because it hashes with the app's own code.
 */
import "dotenv/config";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [command, username] = args.filter((a) => !a.startsWith("--"));

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// Reads a line without echoing it. Works for typed and pasted input.
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          finish();
          return resolve(value);
        }
        if (ch === "\u0003") {
          finish();
          return reject(new Error("Cancelled."));
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function readStdin(): Promise<string> {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data.replace(/\r?\n$/, "");
}

async function main() {
  if (!command || !["show-id", "set-password", "approve-reset"].includes(command) || !username) {
    fail(
      "Usage:\n" +
        "  npm run admin -- show-id <leetcodeUsername>\n" +
        "  npm run admin -- set-password <leetcodeUsername> [--password-stdin]\n" +
        "  npm run admin -- approve-reset <leetcodeUsername>\n" +
        "Add --confirm-remote when TURSO_DATABASE_URL points at a remote database."
    );
  }

  const url = process.env.TURSO_DATABASE_URL || "file:local.db";
  const isLocalFile = url.startsWith("file:");
  console.log(`Database: ${isLocalFile ? url : url.split("?")[0]}`);
  if (!isLocalFile && !flags.has("--confirm-remote")) {
    fail(
      "Refusing to touch a remote database without confirmation.\n" +
        "Check the database above is the one you mean, then add --confirm-remote."
    );
  }

  const db = await import("../db.js");
  await db.initDb(); // makes sure the latest migration (sync_status.reset_frozen_at) is applied

  const found = await db.getUserAuthByUsername(username);
  if (!found) fail(`No member with the LeetCode username "${username}".`);
  const { user, auth } = found;

  if (command === "show-id") {
    const freeze = await db.getResetFreeze(user.id);
    console.log(`Member:        ${user.leetcodeUsername}`);
    console.log(`Internal id:   ${user.id}   <- use this in ADMIN_USER_IDS`);
    console.log(`Has password:  ${auth.passwordHash ? "yes" : "no"}`);
    console.log(`Reset freeze:  ${freeze ?? "none"}`);
  }

  if (command === "approve-reset") {
    const lifted = await db.approveReset(user.id);
    console.log(
      lifted
        ? `Approved: ${user.leetcodeUsername} can claim/reset through the website again.`
        : `Nothing to approve: ${user.leetcodeUsername} has no sticky freeze.` +
            ((await db.getResetFreeze(user.id)) === "sync_failing"
              ? " (Syncs have been failing for days; that lifts by itself once they succeed.)"
              : "")
    );
  }

  if (command === "set-password") {
    if (!process.env.JWT_SECRET) {
      fail("JWT_SECRET is required (set it in .env): the password is hashed with the app's own code.");
    }
    const { hashPassword, MAX_PASSWORD_LENGTH } = await import("../auth.js");
    const MIN_LENGTH = 12; // stricter than the website's minimum: this is for admins

    let password: string;
    if (flags.has("--password-stdin")) {
      password = await readStdin();
    } else if (process.stdin.isTTY) {
      password = await readHidden(`New password for ${user.leetcodeUsername}: `);
      if (password !== (await readHidden("Repeat it: "))) fail("The two passwords don't match.");
    } else {
      fail("No terminal to prompt on. Pipe the password in and add --password-stdin.");
    }

    if (password.length < MIN_LENGTH) fail(`Password must be at least ${MIN_LENGTH} characters.`);
    if (password.length > MAX_PASSWORD_LENGTH) fail(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
    if (password.toLowerCase() === user.leetcodeUsername.toLowerCase()) fail("Password can't be the username.");

    // Changing the hash invalidates every existing session; this also clears any lockout.
    await db.setPasswordHash(user.id, await hashPassword(password));
    console.log(`Password set for ${user.leetcodeUsername}. All their existing sessions are now invalid.`);
  }

  process.exit(0);
}

main().catch((err) => fail(err?.message ?? String(err)));
