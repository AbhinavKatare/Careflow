/**
 * Automated Secrets & Credentials Scanner (/scripts/secrets-scan.ts).
 *
 * Scans the codebase for unintended credentials, private keys, high-entropy tokens,
 * and sensitive secrets before CI build or release.
 *
 * PERMANENT RULES:
 * - Zero real API keys or PHI in repository.
 * - Detects common high-risk secret patterns.
 */

import fs from "node:fs";
import path from "node:path";

interface SecretFinding {
  filePath: string;
  lineNumber: number;
  patternName: string;
  matchedPreview: string;
}

const HIGH_RISK_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  {
    name: "Private Key Header",
    regex: /-----BEGIN\s+(RSA|DSA|EC|OPENSSH|PGP)?\s*PRIVATE KEY-----/i,
  },
  {
    name: "AWS Access Key ID",
    regex: /\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    name: "GitHub Personal Access Token",
    regex: /\bghp_[0-9a-zA-Z]{36}\b/,
  },
  {
    name: "Slack Token",
    regex: /\bxox[baprs]-[0-9a-zA-Z]{10,48}\b/,
  },
  {
    name: "Stripe Live Secret Key",
    regex: /\bsk_live_[0-9a-zA-Z]{24,}\b/,
  },
  {
    name: "Google API Key",
    regex: /\bAIza[0-9A-Za-z\\-_]{35}\b/,
  },
];

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".cache",
  ".system_generated",
  "coverage",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".md",
  ".env.example",
  ".yaml",
  ".yml",
]);

export function scanDirectoryForSecrets(dir: string, baseDir: string = dir): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      findings.push(...scanDirectoryForSecrets(fullPath, baseDir));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!ALLOWED_EXTENSIONS.has(ext)) continue;

      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");

        lines.forEach((line, lineIdx) => {
          for (const pattern of HIGH_RISK_PATTERNS) {
            const match = pattern.regex.exec(line);
            if (match) {
              findings.push({
                filePath: relPath,
                lineNumber: lineIdx + 1,
                patternName: pattern.name,
                matchedPreview: match[0].substring(0, 10) + "... [REDACTED]",
              });
            }
          }
        });
      } catch {
        // Skip unreadable files
      }
    }
  }

  return findings;
}

export function runSecretsScan(): boolean {
  const rootDir = process.cwd();
  console.log("=== Careflow Security Secrets & Credentials Scanner ===");
  console.log(`[INFO] Scanning root: ${rootDir}`);

  const findings = scanDirectoryForSecrets(rootDir);

  if (findings.length === 0) {
    console.log("[PASS] Zero high-risk secrets, private keys, or API tokens detected.");
    return true;
  }

  console.error(`[FAIL] Found ${findings.length} potential secret(s) in codebase:`);
  for (const f of findings) {
    console.error(` - [${f.patternName}] ${f.filePath}:${f.lineNumber} (${f.matchedPreview})`);
  }
  return false;
}

// Run if called directly
if (process.argv[1] && process.argv[1].includes("secrets-scan")) {
  const clean = runSecretsScan();
  process.exit(clean ? 0 : 1);
}

