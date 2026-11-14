import { evaluationFixtures } from "../shared/fixtures";
import { runPolicyEvaluation } from "../shared/policy";

// Parse CLI arguments: supports `FIXTURE=S05`, `fixture=S05`, `--fixture=S05`, or positional `S05`
function getFixtureIdFromArgs(): string {
  if (process.env.FIXTURE) {
    return process.env.FIXTURE.trim();
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.toUpperCase().startsWith("FIXTURE=")) {
      return arg.split("=")[1].trim();
    }
    if (arg.startsWith("--fixture=")) {
      return arg.split("=")[1].trim();
    }
    if (/^S\d{2}$/i.test(arg.trim())) {
      return arg.trim().toUpperCase();
    }
  }

  return "S05"; // Default if not specified
}

function main() {
  const fixtureId = getFixtureIdFromArgs().toUpperCase();
  const fixture = evaluationFixtures.find((f) => f.id.toUpperCase() === fixtureId);

  if (!fixture) {
    console.error(`[ERROR] Fixture '${fixtureId}' not found in evaluation fixtures.`);
    console.error(`Available fixtures: ${evaluationFixtures.map((f) => f.id).join(", ")}`);
    process.exit(1);
  }

  console.log("================================================================================");
  console.log(`CAREFLOW DETERMINISTIC POLICY CHECK: ${fixture.id} - ${fixture.title}`);
  console.log("================================================================================");
  console.log(`Description : ${fixture.description}`);
  console.log(`Severity    : ${fixture.severity.toUpperCase()} | Group: ${fixture.group}`);
  console.log(`Expected    : ${fixture.expected}`);
  console.log("--------------------------------------------------------------------------------");
  console.log("INPUTS USED:");
  console.log(JSON.stringify(fixture.rawInput, null, 2));
  console.log("--------------------------------------------------------------------------------");

  const result = runPolicyEvaluation(fixture.rawInput);

  console.log(`FIRED RULES (${result.firedRules.length}):`);
  if (result.firedRules.length === 0) {
    console.log("  (None - defaulted to HUMAN_REVIEW_REQUIRED fail-safe)");
  } else {
    for (let i = 0; i < result.firedRules.length; i++) {
      const rule = result.firedRules[i];
      console.log(`  [${i + 1}] ID          : ${rule.id}`);
      console.log(`      Route       : ${rule.route}`);
      console.log(`      Reason Code : ${rule.reason_code}`);
      console.log(`      Description : ${rule.description}`);
    }
  }

  console.log("--------------------------------------------------------------------------------");
  console.log(`FINAL ROUTE    : ${result.finalRoute} (Most restrictive wins)`);
  console.log(`PRIMARY REASON : ${result.primaryReason}`);
  console.log(`RULE VERSION   : ${result.ruleVersion}`);
  console.log(`LATENCY        : ${result.latencyMs} ms (Measured live via performance.now)`);
  console.log("================================================================================");
}

main();

