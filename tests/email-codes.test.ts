/**
 * emailCodes.ts (email sign-up step 5): code generation, the keyed hash that is
 * stored, the constant-time comparison, parsing what a person typed, and the
 * plain-text mails.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, it, mock } from "node:test";
import {
  addEmailCodeMail,
  alreadyRegisteredMail,
  codeMatches,
  EMAIL_CODE_TTL_MINUTES,
  generateCode,
  hashCode,
  parseCodeInput,
  passwordChangedMail,
  passwordResetCodeMail,
  signupCodeMail
} from "../emailCodes.js";
import { createMailer } from "../mailer.js";

const SECRET = "test-secret-test-secret-test-secret-1234";
const originalSecret = process.env.JWT_SECRET;
before(() => {
  process.env.JWT_SECRET = SECRET;
});
afterEach(() => {
  mock.restoreAll();
  process.env.JWT_SECRET = SECRET;
});
after(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

describe("generateCode", () => {
  it("is always six digits, with leading zeros kept", () => {
    const seen = new Set<string>();
    let leadingZero = 0;
    for (let i = 0; i < 2000; i++) {
      const code = generateCode();
      assert.match(code, /^\d{6}$/);
      if (code.startsWith("0")) leadingZero++;
      seen.add(code);
    }
    assert.ok(leadingZero > 0, "padding must keep leading zeros (about 10% of codes)");
    assert.ok(seen.size > 1900, "codes must not repeat or be constant");
  });

  it("draws from the secure source over the whole range 0..999999 and pads", () => {
    const draw = mock.method(crypto, "randomInt", () => 7);
    assert.equal(generateCode(), "000007");
    assert.deepEqual(draw.mock.calls[0].arguments, [0, 1_000_000]);
    draw.mock.mockImplementation(() => 0);
    assert.equal(generateCode(), "000000");
    draw.mock.mockImplementation(() => 999_999);
    assert.equal(generateCode(), "999999");
  });
});

describe("hashCode", () => {
  it("is 64 lowercase hex characters", () => {
    assert.match(hashCode("pending-abc", "123456"), /^[0-9a-f]{64}$/);
  });

  it("matches an independent HMAC (a different implementation), so the format can't drift silently", () => {
    // Computed outside this codebase: key = HMAC-SHA256(JWT_SECRET, "leeterboard/email-code/v1"),
    // tag = HMAC-SHA256(key, "<pendingId>:<code>"), hex.
    assert.equal(hashCode("pending-abc", "123456"), "fa42efca6ee565f36bb7a9690294b554104f6691709b0069cb172501526aa3e1");
    assert.equal(hashCode("pending-abc", "000007"), "73160b2d63b4a344e393691f0407934b2b7cdef2ffa2f357d642522213c2dc48");
  });

  it("is keyed by a DERIVED key: not by a bare hash, and not by JWT_SECRET used directly", () => {
    const stored = hashCode("pending-abc", "123456");
    const bare = crypto.createHash("sha256").update("pending-abc:123456").digest("hex");
    const direct = crypto.createHmac("sha256", SECRET).update("pending-abc:123456").digest("hex");
    assert.notEqual(stored, bare);
    assert.equal(direct, "8d23e277b7860a91d6a4bf7fb6d437297480975d222c575b15642e23289c4bc7");
    assert.notEqual(stored, direct, "the session-signing key must not be reused for code hashes");
  });

  it("is the same for the same input and different for any change of id, code or secret", () => {
    const base = hashCode("pending-abc", "123456");
    assert.equal(hashCode("pending-abc", "123456"), base);
    assert.notEqual(hashCode("pending-abd", "123456"), base);
    assert.notEqual(hashCode("pending-abc", "123457"), base);
    process.env.JWT_SECRET = "another-secret-another-secret-another-1234";
    assert.notEqual(hashCode("pending-abc", "123456"), base);
  });

  it("can't be moved to another row: the id is part of what is hashed", () => {
    assert.equal(codeMatches("row-1", "123456", hashCode("row-1", "123456")), true);
    assert.equal(codeMatches("row-2", "123456", hashCode("row-1", "123456")), false);
  });

  it("does not let an id that contains a colon pass for a different id and code", () => {
    // "a:123456" + ":" + "000000" vs "a" + ":" + "123456:000000"-style confusion:
    // the code is always exactly 6 digits, so the pair is read one way only.
    assert.notEqual(hashCode("a:123456", "000000"), hashCode("a", "123456"));
  });

  it("throws, instead of hashing something wrong, for a missing id or a code that isn't six digits", () => {
    for (const code of ["", "12345", "1234567", "12345a", " 123456", "١٢٣٤٥٦", undefined as unknown as string, 123456 as unknown as string]) {
      assert.throws(() => hashCode("pending-abc", code), TypeError, JSON.stringify(code));
    }
    assert.throws(() => hashCode("", "123456"), TypeError);
    assert.throws(() => hashCode(undefined as unknown as string, "123456"), TypeError);
  });

  it("throws loudly when JWT_SECRET is missing or too short, so a broken deployment doesn't look like wrong codes", () => {
    delete process.env.JWT_SECRET;
    assert.throws(() => hashCode("pending-abc", "123456"), /JWT_SECRET/);
    process.env.JWT_SECRET = "short";
    assert.throws(() => hashCode("pending-abc", "123456"), /JWT_SECRET/);
    delete process.env.JWT_SECRET;
    assert.throws(() => codeMatches("pending-abc", "123456", "a".repeat(64)), /JWT_SECRET/);
  });
});

describe("codeMatches", () => {
  const stored = () => hashCode("pending-abc", "123456");

  it("is true only for the right code on the right row", () => {
    assert.equal(codeMatches("pending-abc", "123456", stored()), true);
    assert.equal(codeMatches("pending-abc", "123457", stored()), false);
    assert.equal(codeMatches("pending-abc", "000000", stored()), false);
    assert.equal(codeMatches("pending-xyz", "123456", stored()), false);
  });

  it("accepts the stored hash in either letter case", () => {
    assert.equal(codeMatches("pending-abc", "123456", stored().toUpperCase()), true);
  });

  it("is false, and never throws, for malformed input of any kind", () => {
    const codes: unknown[] = [undefined, null, 123456, 0, {}, [], ["123456"], true, "", "12345", "1234567", "12345a", " 123456", "123456 ", "123 456", "١٢٣٤٥٦", "1".repeat(10_000), { toString: () => "123456" }];
    for (const code of codes) assert.equal(codeMatches("pending-abc", code, stored()), false, JSON.stringify(code));

    const hashes: unknown[] = [undefined, null, 5, {}, [], "", "abc", "z".repeat(64), stored().slice(1), `${stored()}0`, stored().replace(/./, "g")];
    for (const hash of hashes) assert.equal(codeMatches("pending-abc", "123456", hash), false, JSON.stringify(hash));

    for (const id of [undefined, null, 5, {}, "", []]) assert.equal(codeMatches(id, "123456", stored()), false, JSON.stringify(id));
  });

  it("compares with crypto.timingSafeEqual on two equal-length buffers", () => {
    const spy = mock.method(crypto, "timingSafeEqual");
    assert.equal(codeMatches("pending-abc", "123456", stored()), true);
    assert.equal(spy.mock.calls.length, 1);
    const [a, b] = spy.mock.calls[0].arguments as [Buffer, Buffer];
    assert.ok(Buffer.isBuffer(a) && Buffer.isBuffer(b));
    assert.equal(a.length, 32);
    assert.equal(b.length, 32);

    // Malformed input is refused before any comparison is attempted.
    spy.mock.resetCalls();
    assert.equal(codeMatches("pending-abc", "123456", "short"), false);
    assert.equal(codeMatches("pending-abc", "12", stored()), false);
    assert.equal(spy.mock.calls.length, 0);
  });
});

describe("parseCodeInput", () => {
  it("gives the six digits for a clean code and for common paste formats", () => {
    assert.equal(parseCodeInput("123456"), "123456");
    assert.equal(parseCodeInput("  123456\n"), "123456");
    assert.equal(parseCodeInput("123 456"), "123456");
    assert.equal(parseCodeInput("123-456"), "123456");
    assert.equal(parseCodeInput("000123"), "000123");
  });

  it("is null for anything that can't be a code", () => {
    for (const bad of [undefined, null, 123456, {}, "", "12345", "1234567", "12345a", "abcdef", "١٢٣٤٥٦", "12 34", "123456123456", "1".repeat(100), " ".repeat(100) + "123456"]) {
      assert.equal(parseCodeInput(bad), null, JSON.stringify(bad));
    }
  });
});

describe("the mails", () => {
  const CODE = "482916";
  const codeMails = [
    ["sign-up", () => signupCodeMail(CODE), /sign up|create/i, /no account will be created/i],
    ["add e-mail", () => addEmailCodeMail(CODE), /add this email address/i, /nothing will be changed/i],
    ["password reset", () => passwordResetCodeMail(CODE), /reset your leeterboard password/i, /password will not change/i]
  ] as const;
  const noticeMails = [
    ["already registered", alreadyRegisteredMail],
    ["password changed", passwordChangedMail]
  ] as const;
  const all = [...codeMails.map(([n, f]) => [n, f] as const), ...noticeMails];

  const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

  for (const [name, build, purpose, ignore] of codeMails) {
    describe(`${name} code`, () => {
      it("has the code exactly once, in the text and never in the subject", () => {
        const { subject, text } = build();
        assert.equal(countOf(text, CODE), 1);
        assert.equal(subject.includes(CODE), false);
        assert.equal(/\d{4,}/.test(subject), false, "no long digit run in the subject");
      });

      it("says what it is for, the 10-minute expiry, single use, not to share it, and to ignore it if it wasn't them", () => {
        const { text } = build();
        assert.match(text, purpose);
        assert.match(text, /expires in 10 minutes/);
        assert.match(text, /works once/);
        assert.match(text, /do not share/i);
        assert.match(text, ignore);
        assert.match(text, /ignore this email/i);
      });
    });
  }

  it("states a different expiry when asked, and says '1 minute' in the singular", () => {
    assert.equal(EMAIL_CODE_TTL_MINUTES, 10);
    assert.match(signupCodeMail(CODE, 15).text, /expires in 15 minutes/);
    assert.match(signupCodeMail(CODE, 1).text, /expires in 1 minute,/);
    for (const bad of [0, -5, 1.5, NaN]) assert.throws(() => signupCodeMail(CODE, bad), RangeError, String(bad));
  });

  it("refuses to build a mail around something that is not a six-digit code", () => {
    for (const bad of ["", "12345", "1234567", "12345a", "123456\nBcc: x@y.com", "١٢٣٤٥٦"]) {
      assert.throws(() => signupCodeMail(bad), TypeError, JSON.stringify(bad));
      assert.throws(() => addEmailCodeMail(bad), TypeError);
      assert.throws(() => passwordResetCodeMail(bad), TypeError);
    }
  });

  it("notices carry no code and no digits at all", () => {
    for (const [name, build] of noticeMails) {
      const { subject, text } = build();
      assert.equal(/\d/.test(subject + text), false, `${name} must not contain a digit`);
    }
  });

  it("already-registered tells the owner what to do, gives nothing away, and the password-changed notice says what to do if it wasn't them", () => {
    const registered = alreadyRegisteredMail().text;
    assert.match(registered, /already belongs to an account/);
    assert.match(registered, /Forgot password/);
    assert.match(registered, /ignore this email/);
    const changed = passwordChangedMail().text;
    assert.match(changed, /was just changed/);
    assert.match(changed, /If you did not, choose "Forgot password"/);
  });

  for (const [name, build] of all) {
    it(`${name}: plain ASCII text, no links, no HTML, no leftover placeholders`, () => {
      const { subject, text } = build();
      for (const part of [subject, text]) {
        assert.match(part, /^[\x20-\x7e\n]+$/, "printable ASCII and line feeds only");
        assert.equal(/https?:|www\.|\.com|\.org|\.net|<|>|&[a-z]+;/i.test(part), false, "no link or markup");
        assert.equal(/undefined|null|NaN|\$\{|\{\{/.test(part), false, "no template leftovers");
      }
      assert.equal(subject.trim(), subject);
      assert.ok(subject.length > 0 && subject.length <= 80);
      assert.ok(text.endsWith(".") && !text.endsWith("\n"));
    });
  }

  it("every mail is accepted by the mailer's own message checks", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-codes-"));
    try {
      const mailer = createMailer({ provider: "outbox", dir, from: null }, { production: false });
      for (const [, build] of all) await mailer.send({ to: "someone@example.com", ...build() });
      assert.equal(fs.readdirSync(dir).length, all.length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
