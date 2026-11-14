.PHONY: policy-check test verify export-feedback

policy-check:
	@node ./node_modules/tsx/dist/cli.mjs scripts/policy-check.ts $(FIXTURE)

export-feedback:
	@node ./node_modules/tsx/dist/cli.mjs scripts/export-feedback.ts

test:
	@node ./node_modules/vitest/vitest.mjs run

verify:
	@node scripts/verify-integrity.mjs

