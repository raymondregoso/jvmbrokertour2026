// Check a password against your JVM_USERS value on your own computer, before redeploying.
//   node scripts/check-user.mjs
// Paste the JVM_USERS value exactly as it is in Vercel, then the email and password.
import crypto from "node:crypto";
import readline from "node:readline";

function ask(q, hidden) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(q)) process.stdout.write(s); };
    rl.question(q, a => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a); });
  });
}
const unquote = v => String(v || "").trim().replace(/^["'\s]+|["'\s]+$/g, "");
const value = await ask("JVM_USERS value (paste, then Enter): ");
const email = (await ask("Email: ")).trim().toLowerCase();
const pw = await ask("Password: ", true);
const entries = unquote(value).split(/[,\r\n]+/).map(unquote).filter(Boolean);
const mine = entries.map(e => { const i = e.indexOf(":"); return [e.slice(0, i).trim(), e.slice(i + 1)]; }).filter(([e]) => (e || "").toLowerCase() === email);
console.log(`\n${entries.length} entr${entries.length === 1 ? "y" : "ies"} found.`);
if (/^\s*["']/.test(value)) console.log("Note: the value starts with a quote. The app now ignores it, but you can remove quotes in Vercel.");
if (!mine.length) { console.log(`✗ ${email} is not in this list.`); process.exit(1); }
if (mine.length > 1) console.log(`Note: ${email} is listed ${mine.length} times. The LAST one is used — delete the older line(s).`);
const rest = mine[mine.length - 1][1];
const h = rest.match(/^([0-9a-f]{32}):([0-9a-f]{64})$/i);
let ok;
if (h) ok = crypto.scryptSync(pw, h[1], 32, { N: 16384, r: 8, p: 1 }).toString("hex") === h[2].toLowerCase();
else ok = pw === rest;
console.log(ok ? `✓ The password matches ${email}. If sign-in still fails, the deployed JVM_USERS is different from what you pasted here (check Production and redeploy).` : `✗ The password does not match ${email}'s entry.`);
