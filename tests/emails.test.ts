import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkEmail, EMAIL_LOCAL_MAX_LENGTH, EMAIL_MAX_LENGTH, maskEmail, normalizeEmail, parseAllowedDomains } from "../emails.js";

const accepted = (value: unknown, allowed: string[] = []) => {
  const check = checkEmail(value, allowed);
  assert.equal(check.ok, true, `expected ${JSON.stringify(value)} to be accepted`);
  return check.ok ? check.email : "";
};
const error = (value: unknown, allowed: string[] = []) => {
  const check = checkEmail(value, allowed);
  assert.equal(check.ok, false, `expected ${JSON.stringify(value)} to be rejected`);
  return check.ok ? "" : check.error;
};

describe("checkEmail: accepting", () => {
  it("accepts ordinary addresses and lowercases them", () => {
    assert.equal(accepted("alice@example.com"), "alice@example.com");
    assert.equal(accepted("Alice.Smith@Example.COM"), "alice.smith@example.com");
    assert.equal(accepted("a@b.co"), "a@b.co");
    assert.equal(accepted("user@mail.school.edu.ma"), "user@mail.school.edu.ma");
    assert.equal(accepted("x@xn--bcher-kva.example"), "x@xn--bcher-kva.example"); // punycode domain
  });

  it("keeps +tags and dots: they are part of the address", () => {
    assert.equal(accepted("first.last+leeter@example.com"), "first.last+leeter@example.com");
    assert.equal(accepted("a.b.c@example.com"), "a.b.c@example.com");
    assert.notEqual(accepted("ab@example.com"), accepted("a.b@example.com"));
  });

  it("accepts the standard symbols in the local part", () => {
    assert.equal(accepted("o'brien@example.com"), "o'brien@example.com");
    assert.equal(accepted("a_b-c%d=e@example.com"), "a_b-c%d=e@example.com");
  });

  it("trims surrounding whitespace, including a pasted trailing newline", () => {
    assert.equal(accepted("  bob@example.com  "), "bob@example.com");
    assert.equal(accepted("bob@example.com\n"), "bob@example.com");
    assert.equal(accepted("\tbob@example.com\r\n"), "bob@example.com");
  });

  it("accepts exactly the maximum lengths", () => {
    const local = "a".repeat(EMAIL_LOCAL_MAX_LENGTH);
    assert.equal(accepted(`${local}@example.com`), `${local}@example.com`);
    // 64 + "@" + 189 = 254 characters in total.
    const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
    const longest = `${local}@${domain}`;
    assert.equal(longest.length, EMAIL_MAX_LENGTH);
    assert.equal(accepted(longest), longest);
    assert.equal(accepted(`a@${"b".repeat(63)}.com`), `a@${"b".repeat(63)}.com`);
  });
});

describe("checkEmail: rejecting", () => {
  it("asks for an address when there is none", () => {
    for (const bad of [undefined, null, 42, {}, [], true, "", "   ", "\n"]) {
      assert.equal(error(bad), "Email is required.", JSON.stringify(bad));
    }
  });

  it("rejects a missing, doubled or extra @", () => {
    for (const bad of ["alice", "alice.example.com", "@example.com", "alice@", "a@@example.com", "a@b@example.com"]) {
      assert.equal(error(bad), "Enter a valid email address.", bad);
    }
  });

  it("rejects spaces, tabs and every control character, so nothing can inject a mail header", () => {
    const msg = "Email can't contain spaces or line breaks.";
    for (const bad of [
      "a b@example.com",
      "a@exa mple.com",
      "a\t@example.com",
      "a@example.com\r\nBcc: victim@example.net",
      "a\r@example.com",
      "a\n@example.com",
      "a@example.com\nSubject: hi",
      "a\u0000@example.com",
      "a\u007f@example.com",
      "a@example.com\u0001b"
    ]) {
      assert.equal(error(bad), msg, JSON.stringify(bad));
    }
  });

  it("rejects non-ASCII addresses", () => {
    for (const bad of ["ä@example.com", "a@bücher.de", "用户@example.com", "a@example.com\u200b", "a@exаmple.com"]) {
      assert.match(error(bad), /aren't supported/, bad);
    }
  });

  it("rejects quotes, brackets, commas and other characters that could break a header", () => {
    for (const bad of ["a<b>@example.com", "<a@example.com>", "a,b@example.com", "a;b@example.com", "a(b)@example.com", "a\\b@example.com", 'a"b@example.com']) {
      assert.equal(error(bad), "Enter a valid email address.", bad);
    }
    // These also contain a space, which is reported first.
    for (const bad of ['"a b"@example.com', "Alice <a@example.com>"]) error(bad);
  });

  it("rejects a malformed local part", () => {
    for (const bad of [".a@example.com", "a.@example.com", "a..b@example.com"]) {
      assert.equal(error(bad), "Enter a valid email address.", bad);
    }
  });

  it("rejects a malformed domain", () => {
    for (const bad of [
      "a@localhost", // no dot
      "a@example.", // trailing dot
      "a@.example.com",
      "a@example..com",
      "a@-example.com",
      "a@example-.com",
      "a@exa_mple.com",
      "a@example.c", // one-character TLD
      "a@example.123", // numeric TLD
      "a@1.2.3.4",
      "a@[1.2.3.4]",
      "a@[IPv6:::1]"
    ]) {
      assert.equal(error(bad), "Enter a valid email address.", bad);
    }
  });

  it("rejects over-long input", () => {
    assert.equal(error(`${"a".repeat(EMAIL_LOCAL_MAX_LENGTH + 1)}@example.com`), "Enter a valid email address.");
    assert.equal(error(`a@${"b".repeat(64)}.com`), "Enter a valid email address.");
    const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`;
    const tooLong = `${"a".repeat(64)}@${domain}`;
    assert.equal(tooLong.length, EMAIL_MAX_LENGTH + 1);
    assert.equal(error(tooLong), "That email address is too long.");
    assert.equal(error("a".repeat(5000)), "That email address is too long.");
  });
});

describe("checkEmail: allowed domains", () => {
  const allowed = ["school.edu", "uni.ma"];

  it("lets any domain through when the list is empty", () => {
    assert.equal(accepted("a@anything.example", []), "a@anything.example");
    assert.equal(accepted("a@anything.example"), "a@anything.example");
  });

  it("accepts an address on a listed domain, whatever its letter case", () => {
    assert.equal(accepted("a@school.edu", allowed), "a@school.edu");
    assert.equal(accepted("A@SCHOOL.EDU", allowed), "a@school.edu");
    assert.equal(accepted("b@uni.ma", allowed), "b@uni.ma");
  });

  it("matches the domain exactly: no subdomains, no look-alikes, no suffix tricks", () => {
    const msg = "Sign-up is limited to email addresses from approved domains.";
    for (const bad of [
      "a@mail.school.edu",
      "a@notschool.edu",
      "a@school.edu.evil.com",
      "a@school.edux",
      "a@evil.com",
      "school.edu@evil.com",
      "a@evil.com@school.edu"
    ]) {
      const check = checkEmail(bad, allowed);
      assert.equal(check.ok, false, bad);
      if (!check.ok && bad !== "a@evil.com@school.edu") assert.equal(check.error, msg, bad);
    }
  });

  it("still reports a malformed address as malformed, not as a domain problem", () => {
    assert.equal(error("not-an-address", allowed), "Enter a valid email address.");
    assert.equal(error("", allowed), "Email is required.");
  });
});

describe("parseAllowedDomains", () => {
  it("splits on commas, trims, lowercases and drops empty entries", () => {
    assert.deepEqual(parseAllowedDomains("School.edu, uni.ma ,,  ,Example.COM"), ["school.edu", "uni.ma", "example.com"]);
  });

  it("gives an empty list (any domain) for an empty or missing value", () => {
    for (const v of [undefined, null, "", "   ", ",", " , ,"]) {
      assert.deepEqual(parseAllowedDomains(v as string | undefined), [], JSON.stringify(v));
    }
  });

  it("removes repeats and a leading @", () => {
    assert.deepEqual(parseAllowedDomains("@school.edu,school.edu,SCHOOL.EDU"), ["school.edu"]);
  });

  it("keeps a mistyped entry, so the site stays restricted instead of opening up", () => {
    const list = parseAllowedDomains("school.edu;uni.ma");
    assert.equal(list.length, 1);
    assert.equal(checkEmail("a@school.edu", list).ok, false);
    assert.equal(checkEmail("a@uni.ma", list).ok, false);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases, nothing else", () => {
    assert.equal(normalizeEmail("  A.B+Tag@Example.COM \n"), "a.b+tag@example.com");
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    assert.equal(maskEmail("alice@example.com"), "a***@example.com");
    assert.equal(maskEmail("ab@example.com"), "a***@example.com");
  });

  it("hides a one-character local part and anything that is not an address", () => {
    for (const v of ["a@example.com", "", "nope", "@example.com", "alice@"]) {
      assert.equal(maskEmail(v), "***", v);
    }
  });

  it("never contains the rest of the local part", () => {
    const masked = maskEmail("secretname@example.com");
    assert.equal(masked.includes("secretname"), false);
    assert.equal(masked.includes("ecret"), false);
  });
});
