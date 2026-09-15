import { randomBytes } from "node:crypto";

/** Rotate only published default credentials, preserving account identity and characters.
 * Row locks keep concurrent startups from overwriting an already-changed password. */
export async function rotateDefaultAccountPasswords(database) {
  return database.transaction(async (tx) => {
    const changed = [];
    // account.name is unique, so this query returns at most two rows.
    const accounts = await tx`
      SELECT id,name,password_hash FROM account
      WHERE name IN ('admin','player') ORDER BY name FOR UPDATE
    `;
    for (const account of accounts) {
      if (!(await Bun.password.verify("password", account.password_hash))) {
        continue;
      }
      const passwordHash = await Bun.password.hash(
        randomBytes(32).toString("base64url"),
        { algorithm: "argon2id" },
      );
      await tx`UPDATE account SET password_hash=${passwordHash} WHERE id=${account.id}`;
      changed.push(account.name);
    }
    return changed;
  });
}
