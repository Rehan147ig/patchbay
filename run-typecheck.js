/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require("child_process");
try {
  const output = execSync("pnpm typecheck", {
    cwd: "C:\\Users\\SHAIK MOHAMMAD REHAN\\patchbay",
    timeout: 120000,
  }).toString();
  console.log(output);
} catch (e) {
  console.error(e.stderr?.toString() || e.message);
  process.exit(1);
}
