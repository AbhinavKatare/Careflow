import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function run(cmd, desc) {
  process.stdout.write(`\n[STEP] ${desc} (${cmd})...\n`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: "inherit", env: { ...process.env, CI: "true" } });
    process.stdout.write(`[PASS] ${desc}\n`);
  } catch (_error) {
    process.stderr.write(`[FAIL] ${desc} failed\n`);
    process.exit(1);
  }
}

function verifyNoManusReferences() {
  process.stdout.write("\n[CHECK] Scanning codebase for residual Manus references...\n");
  const scanDirs = ["client/src", "server", "shared", "drizzle", "backend", "alembic"];
  const scanFiles = ["client/index.html", "vite.config.ts", "package.json", ".gitignore", ".dockerignore"];

  const found = [];

  function scanFile(filePath) {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    lines.forEach((line, idx) => {
      if (/manus/i.test(line)) {
        found.push(`${filePath}:${idx + 1} -> ${line.trim()}`);
      }
    });
  }

  function scanDir(dirPath) {
    const fullPath = path.join(ROOT, dirPath);
    if (!fs.existsSync(fullPath)) return;
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(fullPath, entry.name);
      if (entry.isDirectory()) {
        scanDir(path.join(dirPath, entry.name));
      } else if (/\.(ts|tsx|js|jsx|json|html|css|sql|md)$/.test(entry.name)) {
        scanFile(entryPath);
      }
    }
  }

  for (const dir of scanDirs) scanDir(dir);
  for (const file of scanFiles) {
    const full = path.join(ROOT, file);
    if (fs.existsSync(full)) scanFile(full);
  }

  if (found.length > 0) {
    console.error("[FAIL] Found residual Manus references:");
    for (const match of found) console.error("  " + match);
    process.exit(1);
  }
  process.stdout.write("[PASS] Zero Manus references found.\n");
}

function verifyEvalIntegrity() {
  process.stdout.write("\n[CHECK] Verifying evaluation integrity and absence of hardcoded metrics...\n");
  const fixturesPath = path.join(ROOT, "shared", "fixtures.ts");
  const fixturesContent = fs.readFileSync(fixturesPath, "utf-8");

  // Check 1: No outcome-encoding flags in fixtures
  const forbiddenFlags = [
    "controlledUrgentFixture",
    "unsupportedDraftClaim",
    "generationFailure",
    "contradiction: true",
  ];
  for (const flag of forbiddenFlags) {
    if (fixturesContent.includes(flag)) {
      console.error(`[FAIL] Forbidden outcome-encoding flag found in fixtures.ts: "${flag}"`);
      process.exit(1);
    }
  }

  // Check 2: No hardcoded latencies on fixtures
  const lines = fixturesContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/latencyMs:\s*\d{2,}/.test(line)) {
      console.error(`[FAIL] Hardcoded latency found in fixtures.ts:${i + 1} -> ${line.trim()}`);
      process.exit(1);
    }
  }

  // Check 3: Home.tsx does not hardcode test count or score literals
  const homePath = path.join(ROOT, "client", "src", "pages", "Home.tsx");
  const homeContent = fs.readFileSync(homePath, "utf-8");
  if (/label="Test scenarios"\s+value="\d+"/.test(homeContent)) {
    console.error("[FAIL] Hardcoded test scenarios metric found in Home.tsx");
    process.exit(1);
  }

  // Check 4: Check that patient names in fixtures are obviously fake
  const realisticNameCheck = /Maya Chen|Jordan Rivera|Avery Thompson|Sam Patel|Nora Williams|Eli Brooks|Leah Kim/;
  if (realisticNameCheck.test(fixturesContent)) {
    console.error("[FAIL] Realistic patient names detected in fixtures.ts; expected fake names like Demo Patient 001.");
    process.exit(1);
  }

  process.stdout.write("[PASS] Evaluation integrity verified (raw inputs only, dynamic metrics, fake names).\n");
}

console.log("=== Careflow Integrity & Verification Suite ===");
run("node ./node_modules/typescript/bin/tsc --noEmit", "TypeScript type-checking");
run("node ./node_modules/eslint/bin/eslint.js .", "ESLint code quality");
run("node ./node_modules/tsx/dist/cli.mjs scripts/secrets-scan.ts", "Security & secrets scanner");
run("node ./node_modules/vitest/vitest.mjs run", "Vitest unit & workflow tests");
run("node ./node_modules/tsx/dist/cli.mjs scripts/ci-gate-check.ts", "CI safety gate & route regression check");
run("python -m pytest backend/tests", "Backend models & Alembic migration tests");
run("node ./node_modules/vite/bin/vite.js build", "Production bundle build");
verifyNoManusReferences();
verifyEvalIntegrity();

console.log("\n================================================");
console.log("  ALL VERIFICATION CHECKS PASSED SUCCESSFULLY  ");
console.log("================================================");
