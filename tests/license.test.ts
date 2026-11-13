import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { LEGAL } from "../src/legal.js";

const read = (file: string) => fs.readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

describe("license", () => {
  const license = read("LICENSE");

  it("ships an MIT LICENSE file", () => {
    assert.match(license, /^MIT License\n/);
    assert.match(license, /Permission is hereby granted, free of charge/);
  });

  it("names the operator from the legal settings as the copyright holder", () => {
    assert.match(license, /^Copyright \(c\) \d{4} (.+)$/m);
    assert.ok(license.includes(`Copyright (c) ${license.match(/\d{4}/)![0]} ${LEGAL.operatorName}`));
  });

  it("is declared in package.json", () => {
    assert.equal(JSON.parse(read("package.json")).license, "MIT");
  });

  it("is linked from the README", () => {
    assert.match(read("README.md"), /\[MIT License\]\(LICENSE\)/);
  });
});
