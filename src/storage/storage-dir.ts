import path from "node:path";
import os from "node:os";

// Lazy (not a module-level constant) so it still picks up FB_MARKETPLACE_HOME
// even when set after this module is imported (e.g. via a .env file loaded
// at the top of a script, since ESM hoists imports above other statements).
export function getStorageDir(): string {
  return process.env.FB_MARKETPLACE_HOME || path.join(os.homedir(), ".fb-marketplace");
}
