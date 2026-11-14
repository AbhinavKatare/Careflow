---
description: Run the full Careflow integrity verification pipeline (typecheck, lint, test, build, and metric grep audits)
---

# Careflow Verification Workflow

This workflow executes the complete verification suite required by the project's permanent integrity rules.

## Steps

1. **Run Full Verification & Audit Suite**
   Execute the dedicated integrity script which performs TypeScript check, ESLint, Vitest, production Vite build, and automated grep audits for hardcoded metrics, residual boilerplate, and fixture integrity:

   ```powershell
   node scripts/verify-integrity.mjs
   ```

2. **Verify Individual Steps (Manual Inspection)**

   - **TypeScript Check**:
     ```powershell
     node ./node_modules/typescript/bin/tsc --noEmit
     ```

   - **Lint**:
     ```powershell
     node ./node_modules/eslint/bin/eslint.js .
     ```

   - **Unit & Workflow Tests**:
     ```powershell
     node ./node_modules/vitest/vitest.mjs run
     ```

   - **Static Build**:
     ```powershell
     node ./node_modules/vite/bin/vite.js build
     ```

3. **Grep Audits for Metric Integrity**

   - Verify no hardcoded test count or scenario literals exist in UI components:
     ```powershell
     Select-String -Path "client/src/pages/Home.tsx" -Pattern 'label="Test scenarios"\s+value="\d+"'
     ```

   - Verify fixtures contain raw inputs only without outcome-encoding flags:
     ```powershell
     Select-String -Path "shared/fixtures.ts" -Pattern "controlledUrgentFixture|unsupportedDraftClaim|generationFailure"
     ```

   - Verify zero residual Manus references:
     ```powershell
     Get-ChildItem -Path client, server, shared, drizzle -Recurse -File | Select-String -Pattern "manus"
     ```

