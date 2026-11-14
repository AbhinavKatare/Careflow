import { evaluationFixtures } from "../shared/fixtures";
import { defaultWorkflowSpec, evaluatePolicy } from "../shared/policy";

function getTargetFixtureId(): string {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg.toUpperCase().startsWith("FIXTURE=")) {
      return arg.split("=")[1].trim().toUpperCase();
    }
    if (arg.startsWith("--fixture=")) {
      return arg.split("=")[1].trim().toUpperCase();
    }
    if (/^S\d{2}$/i.test(arg.trim())) {
      return arg.trim().toUpperCase();
    }
  }
  return (process.env.FIXTURE || "S05").trim().toUpperCase();
}

function main() {
  const fixtureId = getTargetFixtureId();
  const fixture = evaluationFixtures.find((f) => f.id.toUpperCase() === fixtureId);

  if (!fixture) {
    console.error(`[ERROR] Unknown fixture ID: '${fixtureId}'.`);
    console.error(`Available fixtures: ${evaluationFixtures.map((f) => f.id).join(", ")}`);
    process.exit(1);
  }

  console.log("================================================================================");
  console.log(`POLICY EXPLAIN: ${fixture.id} - ${fixture.title}`);
  console.log("================================================================================");
  console.log(`Description     : ${fixture.description}`);
  console.log(`Spec Version    : ${defaultWorkflowSpec.spec_version}`);
  console.log(`Content Hash    : ${defaultWorkflowSpec.content_hash}`);
  console.log("--------------------------------------------------------------------------------");
  console.log("INPUTS USED:");
  console.log(JSON.stringify(fixture.rawInput, null, 2));
  console.log("--------------------------------------------------------------------------------");

  const result = evaluatePolicy(fixture.rawInput, defaultWorkflowSpec);

  console.log(`FIRED RULES (${result.firedRules.length}):`);
  for (let i = 0; i < result.firedRules.length; i++) {
    const rule = result.firedRules[i];
    console.log(`  [${i + 1}] ID          : ${rule.id}`);
    console.log(`      Route       : ${rule.route}`);
    console.log(`      Reason Code : ${rule.reason_code}`);
    console.log(`      Description : ${rule.description}`);
  }

  console.log("--------------------------------------------------------------------------------");
  console.log(`ROUTE DECISION : [${result.route}] (Most restrictive route wins)`);
  console.log(`PRIMARY REASON : ${result.primaryReason}`);
  console.log(`LATENCY        : ${result.latencyMs} ms (Measured live via performance.now)`);
  console.log("================================================================================");
}

main();

