// Creates a password hash for the admin dashboard.
// Usage:  npm run hash-password -- <username> <password>
// Paste the printed line into the ADMIN_USERS secret (see README).
import { pbkdf2Sync, randomBytes } from "node:crypto";

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error("Usage: npm run hash-password -- <username> <password>");
  process.exit(1);
}
if (password.length < 10) {
  console.error("Use a password of at least 10 characters.");
  process.exit(1);
}
const iterations = 100000; // Cloudflare Workers maximum for PBKDF2
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const value = `pbkdf2_sha256$${iterations}$${salt.toString("base64")}$${hash.toString("base64")}`;
console.log(`\nFor user "${username.toLowerCase()}", add this inside ADMIN_USERS:\n`);
console.log(`"${username.toLowerCase()}":"${value}"`);
console.log(`\nTwo users together look like:\n{"user1":"pbkdf2_sha256$...","user2":"pbkdf2_sha256$..."}\n`);
