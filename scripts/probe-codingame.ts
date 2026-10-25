// Prints what CodinGame returns for one handle, so the field names used in
// platforms/codingame.ts can be checked against a real response.
//   npx tsx scripts/probe-codingame.ts <handle-from-profile-url>
const handle = process.argv[2];
if (!handle) {
  console.error("Usage: npx tsx scripts/probe-codingame.ts <handle>");
  process.exit(1);
}
const res = await fetch("https://www.codingame.com/services/CodinGamer/findCodingamePointsStatsByHandle", {
  method: "POST",
  headers: { "Content-Type": "application/json;charset=UTF-8" },
  body: JSON.stringify([handle])
});
console.log("HTTP", res.status);
const body: any = await res.json().catch(() => null);
console.log("top-level keys:", body && Object.keys(body));
console.log("codingamer:", JSON.stringify(body?.codingamer, null, 2));
console.log("xp / level / rank:", body?.xp, body?.level, body?.rank);