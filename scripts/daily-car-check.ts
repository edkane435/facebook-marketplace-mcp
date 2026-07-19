// Standalone runner for scheduled (cron/Routine) use — no MCP client needed.
// Thin CLI wrapper around src/check-runner.ts, which the web server also
// uses for its internal schedule.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/utils/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(__dirname, "..", ".env"));

const { runDailyCheck } = await import("../src/check-runner.js");
await runDailyCheck();
