@echo off
if "%1"=="" (
  node ./node_modules/tsx/dist/cli.mjs scripts/policy-check.ts
  exit /b %errorlevel%
)
if "%1"=="export-feedback" (
  node ./node_modules/tsx/dist/cli.mjs scripts/export-feedback.ts
  exit /b %errorlevel%
)
if "%1"=="policy-check" (
  node ./node_modules/tsx/dist/cli.mjs scripts/policy-check.ts %2
  exit /b %errorlevel%
)
if "%1"=="test" (
  node ./node_modules/vitest/vitest.mjs run
  exit /b %errorlevel%
)
if "%1"=="verify" (
  node scripts/verify-integrity.mjs
  exit /b %errorlevel%
)
echo Unknown target: %1
exit /b 1
