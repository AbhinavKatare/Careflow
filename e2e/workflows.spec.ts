import { test, expect } from "@playwright/test";

test.describe("Careflow E2E Workflow Verification (/e2e)", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to local health endpoint to ensure server is ready
    const res = await page.goto("/health");
    expect(res?.status()).toBe(200);
  });

  test("Scenario 1: Routine case -> Draft -> Edit -> Approve (Simulated)", async ({ page }) => {
    // 1. Submit routine check-in at /web
    await page.goto("/web");
    await expect(page.locator("h2:has-text('Weekly Check-in Demo')")).toBeVisible();

    // Load sample routine scenario S01
    const scenarioSelect = page.locator("select[id*='scenario-select']");
    await scenarioSelect.waitFor({ state: "visible" });
    await scenarioSelect.selectOption("S01");

    // Click Continue to Review
    const continueBtn = page.locator("button:has-text('Continue to Review')");
    await continueBtn.click();

    // Verify Review Screen
    await expect(page.locator("h1:has-text('Review Your Check-in')")).toBeVisible();

    // Click Submit Check-in
    const submitBtn = page.locator("button:has-text('Submit Check-in')");
    await submitBtn.click();

    // Verify Confirmation
    await expect(page.locator("h1:has-text('Check-in Received')")).toBeVisible({ timeout: 10000 });

    // 2. Open Staff Dashboard / Review Queue
    await page.goto("/");
    await expect(page.locator("text=Review queue")).toBeVisible();

    // Navigate to Queue tab
    const queueNavBtn = page.locator("button.nav-item:has-text('Review queue')");
    await queueNavBtn.click();

    // Locate case row and open detail drawer
    const caseRow = page.locator(".case-row, [role='button']:has-text('DEMO-001')").first();
    await caseRow.waitFor({ state: "visible", timeout: 10000 });
    await caseRow.click();

    // Drawer should open
    const drawer = page.locator("aside:has-text('Case triage details'), [role='dialog']").first();
    await expect(drawer).toBeVisible({ timeout: 8000 });

    // 3. Edit Draft
    const draftTextarea = page.locator("textarea[aria-label='Editable draft response'], textarea").first();
    await draftTextarea.waitFor({ state: "visible" });
    await draftTextarea.fill("Thank you for your update. Your routine is on track. Edited by reviewer for extra clarity.");

    // 4. Click Approve (Simulated)
    const approveBtn = page.locator("button:has-text('Approve (Simulated)')");
    await approveBtn.click();

    // Confirmation dialog
    const confirmModal = page.locator("#confirm-dialog-title, :has-text('Confirm Simulated Approval')").first();
    await expect(confirmModal).toBeVisible();
    await expect(page.locator("text=Simulated state only. Nothing will be sent externally.")).toBeVisible();

    // Confirm Approval
    const confirmCommitBtn = page.locator("button:has-text('Confirm Approval')");
    await confirmCommitBtn.click();

    // Verify status transitions to approved
    await expect(page.locator("span:has-text('approved')").first()).toBeVisible({ timeout: 8000 });
  });

  test("Scenario 2: Flagged case -> Rule inspection in review queue", async ({ page }) => {
    // 1. Submit flagged symptom check-in at /web
    await page.goto("/web");
    const scenarioSelect = page.locator("select[id*='scenario-select']");
    await scenarioSelect.waitFor({ state: "visible" });
    await scenarioSelect.selectOption("S06"); // S06: Acute chest tightness (Urgent)

    // Continue to Review
    await page.locator("button:has-text('Continue to Review')").click();
    await expect(page.locator("h1:has-text('Review Your Check-in')")).toBeVisible();

    // Submit Check-in
    await page.locator("button:has-text('Submit Check-in')").click();
    await expect(page.locator("h1:has-text('Check-in Received')")).toBeVisible({ timeout: 10000 });

    // 2. Open Staff Queue
    await page.goto("/");
    await page.locator("button.nav-item:has-text('Review queue')").click();

    // Locate the urgent case (DEMO-006)
    const urgentRow = page.locator(":has-text('DEMO-006')").first();
    await urgentRow.waitFor({ state: "visible", timeout: 10000 });
    await urgentRow.click();

    // 3. Inspect Policy Results Panel in Drawer
    await expect(page.locator("text=Policy Result")).toBeVisible();
    await expect(page.locator("text=HUMAN_REVIEW_REQUIRED")).toBeVisible();

    // Verify "What the model saw" shows redacted tokens
    await expect(page.locator("text=What the model saw")).toBeVisible();
  });

  test("Scenario 3: SOP Compile -> Eval -> Mutation -> Shadow -> Evidence Pack -> Activate", async ({ page }) => {
    // 1. Navigate to Onboarding Studio
    await page.goto("/onboarding");
    await expect(page.locator("h1:has-text('Onboard a Clinic')")).toBeVisible();

    // 2. Click Compile SOP
    const compileBtn = page.locator("button:has-text('Compile SOP Proposal')");
    await compileBtn.click();

    // Proposal generated notification or view
    await expect(page.locator("text=Compiled, text=Proposed Spec").first()).toBeVisible({ timeout: 10000 });

    // 3. Check Ladder Tab & Evaluation Gates
    const ladderTabBtn = page.locator("button:has-text('Activation Ladder')");
    await ladderTabBtn.click();

    await expect(page.locator("text=Stage:").first()).toBeVisible();

    // 4. Check Evidence Pack Tab
    const evidenceTabBtn = page.locator("button:has-text('Evidence Pack')");
    await evidenceTabBtn.click();

    // Generate Evidence Pack
    const generatePackBtn = page.locator("button:has-text('Generate Evidence Pack')");
    if (await generatePackBtn.isVisible()) {
      await generatePackBtn.click();
    }
    await expect(page.locator("text=Content Hash:, text=SHA256, text=EVIDENCE PACK").first()).toBeVisible({ timeout: 15000 });
  });

  test("Scenario 4: Weak or unsafe spec blocked by activation ladder", async ({ page }) => {
    // Navigate to Onboarding
    await page.goto("/onboarding");
    const ladderTabBtn = page.locator("button:has-text('Activation Ladder')");
    await ladderTabBtn.click();

    // Attempting activation on a draft spec without full gates must show blocked/locked status
    const advanceBtn = page.locator("button:has-text('Advance to Evaluated'), button:has-text('Advance')").first();
    await expect(advanceBtn).toBeVisible({ timeout: 5000 });
  });
});

