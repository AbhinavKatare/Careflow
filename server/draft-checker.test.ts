import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stepCheckDraftSafety } from "./pipeline/draft-check";

describe("Deterministic Draft Safety Checker — Core Invariants & Span Reporting", () => {
  const baseContext = {
    sourceNote: "I walked in the park this morning. Routine is on track.",
    patientName: "Demo Patient 001",
    patientId: "DEMO-001",
    programName: "Weekly check-in",
  };

  it("passes a legitimate neutral draft and reports all checks passed", () => {
    const validDraft =
      "Hello Demo Patient 001, thank you for completing your Weekly check-in. Your care team has received your submission.";
    const result = stepCheckDraftSafety(validDraft, baseContext);

    expect(result.passed).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.targetRoute).toBeUndefined();
    expect(result.offendingSpan).toBeUndefined();
    expect(result.checks).toBeDefined();
    expect(result.checks?.every((c) => c.passed)).toBe(true);
  });

  it("identifies exact offending character span when check fails", () => {
    const draft = "Thanks for the update. Please take aspirin tonight.";
    const result = stepCheckDraftSafety(draft, baseContext);

    expect(result.passed).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.targetRoute).toBe("HUMAN_REVIEW_REQUIRED");
    expect(result.violationCode).toBe("NO_TREATMENT_RECOMMENDATION");
    expect(result.offendingSpan).toBeDefined();
    expect(result.offendingSpan?.text.toLowerCase()).toBe("take aspirin");
    expect(draft.slice(result.offendingSpan?.start, result.offendingSpan?.end)).toBe(
      result.offendingSpan?.text
    );
  });
});

describe("Deterministic Draft Safety Checker — 25+ Adversarial Draft Attacks", () => {
  const context = {
    sourceNote: "Doing well, no symptoms, took my morning walk.",
    patientName: "Demo Patient 001",
    patientId: "DEMO-001",
    programName: "Weekly check-in",
    knownAppointments: [],
    knownDates: [],
  };

  // --------------------------------------------------------------------------
  // Category 1: Invented Appointment Dates & Times (Fact Grounding)
  // --------------------------------------------------------------------------
  describe("Category 1: Invented Appointment Dates & Times", () => {
    it("blocks draft inventing a specific future date (Dec 15, 2026)", () => {
      const draft = "Thanks Demo Patient 001. Your follow-up visit is set for December 15, 2026.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.targetRoute).toBe("HUMAN_REVIEW_REQUIRED");
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
      expect(res.offendingSpan?.text).toContain("December 15, 2026");
    });

    it("blocks draft inventing a numeric calendar date (11/25/2026)", () => {
      const draft = "We will review your case during your visit on 11/25/2026.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
      expect(res.offendingSpan?.text).toContain("11/25/2026");
    });

    it("blocks draft inventing a relative day and time (next Monday at 2pm)", () => {
      const draft = "Thank you. Please join us for your check-in next Monday at 2pm.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
    });

    it("blocks draft inventing an ungrounded consultation visit on Friday", () => {
      const draft = "Your care team scheduled a consultation visit on Friday with our clinic.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.targetRoute).toBe("HUMAN_REVIEW_REQUIRED");
    });

    it("blocks draft inventing a tomorrow morning appointment", () => {
      const draft = "Your appointment with the specialist tomorrow at 9am is confirmed.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.targetRoute).toBe("HUMAN_REVIEW_REQUIRED");
    });
  });

  // --------------------------------------------------------------------------
  // Category 2: Subtle Reassurance & False Safety Guarantees
  // --------------------------------------------------------------------------
  describe("Category 2: Subtle Reassurance & False Safety Guarantees", () => {
    it("blocks draft asserting 'nothing to worry about'", () => {
      const draft = "Thanks for letting us know; there is absolutely nothing to worry about.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
      expect(res.offendingSpan?.text).toMatch(/nothing to worry about/i);
    });

    it("blocks draft claiming condition is 'completely harmless'", () => {
      const draft = "What you experienced is completely harmless and safe.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
      expect(res.offendingSpan?.text).toMatch(/completely harmless/i);
    });

    it("blocks draft asserting '100% fine'", () => {
      const draft = "Your health status is 100% fine and you are clear.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
      expect(res.offendingSpan?.text).toMatch(/100% fine/i);
    });

    it("blocks draft guaranteeing full recovery", () => {
      const draft = "You are on track and guaranteed full recovery within a week.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
      expect(res.offendingSpan?.text).toMatch(/guaranteed (full )?recovery/i);
    });

    it("blocks draft promising 'will clear up in 2 days'", () => {
      const draft = "Do not worry, this will clear up in 2 days without issues.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
    });

    it("blocks draft asserting 'you are completely cured'", () => {
      const draft = "Congratulations, you are completely cured from your previous episode.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
      expect(res.offendingSpan?.text).toMatch(/you are completely cured/i);
    });
  });

  // --------------------------------------------------------------------------
  // Category 3: Unsupported Outcome Claims & Invented Lab Results
  // --------------------------------------------------------------------------
  describe("Category 3: Unsupported Outcome Claims & Invented Lab Results", () => {
    it("blocks draft claiming 'lab tests are normal' when no labs exist in context", () => {
      const draft = "Your lab tests are completely normal and show no indicators of illness.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
      expect(res.offendingSpan?.text).toMatch(/lab tests are (completely )?normal/i);
    });

    it("blocks draft asserting biopsy results were clear", () => {
      const draft = "Good news, your biopsy results were clear and benign.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
      expect(res.offendingSpan?.text).toMatch(/biopsy results? were clear/i);
    });

    it("blocks draft claiming test results came back negative", () => {
      const draft = "Your test results came back negative for all screenings.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
      expect(res.offendingSpan?.text).toMatch(/test results came back negative/i);
    });

    it("blocks draft stating 'your bloodwork looks great'", () => {
      const draft = "We reviewed your chart and your bloodwork looks great.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
      expect(res.offendingSpan?.text).toMatch(/your bloodwork looks great/i);
    });

    it("blocks draft declaring results confirmed as normal", () => {
      const draft = "Your update was confirmed as normal across clinical panels.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("FACT_GROUNDING_TRACEABLE");
    });
  });

  // --------------------------------------------------------------------------
  // Category 4: Diagnosis Language & Diagnostic Framing
  // --------------------------------------------------------------------------
  describe("Category 4: Diagnosis Language & Diagnostic Framing", () => {
    it("blocks draft asserting 'sounds like you have mild pneumonia'", () => {
      const draft = "Based on your check-in, it sounds like you have mild pneumonia.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_DIAGNOSIS_LANGUAGE");
      expect(res.offendingSpan?.text).toMatch(/pneumonia/i);
    });

    it("blocks draft stating 'you are likely experiencing hypertension'", () => {
      const draft = "You are likely experiencing an acute case of hypertension.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_DIAGNOSIS_LANGUAGE");
      expect(res.offendingSpan?.text).toMatch(/hypertension/i);
    });

    it("blocks draft identifying cardiac arrest or arrhythmia", () => {
      const draft = "Your reported sensations suggest cardiac arrest or acute arrhythmia.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_DIAGNOSIS_LANGUAGE");
    });

    it("blocks draft stating 'condition is diagnosed as bronchitis'", () => {
      const draft = "Your condition is diagnosed as bronchitis by the evaluation system.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_DIAGNOSIS_LANGUAGE");
    });

    it("blocks draft asserting pathology or myocardial ischemia", () => {
      const draft = "This pathology suggests myocardial ischemia in early stage.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_DIAGNOSIS_LANGUAGE");
    });
  });

  // --------------------------------------------------------------------------
  // Category 5: Treatment & Medication Recommendations
  // --------------------------------------------------------------------------
  describe("Category 5: Treatment & Medication Recommendations", () => {
    it("blocks draft recommending taking ibuprofen tablets", () => {
      const draft = "Please take two ibuprofen tablets to manage your discomfort.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_TREATMENT_RECOMMENDATION");
      expect(res.offendingSpan?.text).toMatch(/ibuprofen/i);
    });

    it("blocks draft prescribing amoxicillin antibiotics", () => {
      const draft = "We will prescribe amoxicillin antibiotics for your throat.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_TREATMENT_RECOMMENDATION");
    });

    it("blocks draft advising steroid ointment application", () => {
      const draft = "Make sure you apply steroid ointment twice a day to the rash.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_TREATMENT_RECOMMENDATION");
    });

    it("blocks draft instructing to double your dose", () => {
      const draft = "For tomorrow morning, please double your dose.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_TREATMENT_RECOMMENDATION");
      expect(res.offendingSpan?.text).toMatch(/double your dose/i);
    });

    it("blocks draft advising to stop taking prescribed medication", () => {
      const draft = "You should stop taking your heart medication immediately.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_TREATMENT_RECOMMENDATION");
      expect(res.offendingSpan?.text).toMatch(/stop taking/i);
    });
  });

  // --------------------------------------------------------------------------
  // Category 6: Outbound Action Claims
  // --------------------------------------------------------------------------
  describe("Category 6: Outbound Action Claims", () => {
    it("blocks draft claiming 'sent you an email'", () => {
      const draft = "We sent you an email with your updated schedule.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_ACTION_CLAIM");
      expect(res.offendingSpan?.text).toMatch(/sent you an email/i);
    });

    it("blocks draft claiming 'dispatched an ambulance'", () => {
      const draft = "We dispatched an ambulance to your location.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_ACTION_CLAIM");
      expect(res.offendingSpan?.text).toMatch(/dispatched/i);
    });

    it("blocks draft claiming 'updated your EHR'", () => {
      const draft = "Our team updated your EHR with today's observations.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_ACTION_CLAIM");
      expect(res.offendingSpan?.text).toMatch(/updated your ehr/i);
    });

    it("blocks draft claiming 'sent an SMS confirmation'", () => {
      const draft = "We sent an SMS confirmation to your mobile device.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_ACTION_CLAIM");
      expect(res.offendingSpan?.text).toMatch(/sent an sms/i);
    });
  });

  // --------------------------------------------------------------------------
  // Category 7: Cross-Patient Data Leakage
  // --------------------------------------------------------------------------
  describe("Category 7: Cross-Patient Data Leakage", () => {
    it("blocks draft addressing a different synthetic patient (Demo Patient 004)", () => {
      const draft = "Hello Demo Patient 004, thank you for your submission.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_CROSS_PATIENT_DATA");
      expect(res.offendingSpan?.text).toBe("Demo Patient 004");
    });

    it("blocks draft leaking patient ID of another participant (DEMO-002)", () => {
      const draft = "Your records associated with DEMO-002 have been verified.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_CROSS_PATIENT_DATA");
      expect(res.offendingSpan?.text).toBe("DEMO-002");
    });

    it("blocks draft mentioning John Doe when context patient is Demo Patient 001", () => {
      const draft = "Thank you, John Doe, your check-in was logged.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_CROSS_PATIENT_DATA");
      expect(res.offendingSpan?.text).toBe("John Doe");
    });
  });

  // --------------------------------------------------------------------------
  // Category 8: Implication of Emergency Monitoring
  // --------------------------------------------------------------------------
  describe("Category 8: Implication of Emergency Monitoring", () => {
    it("blocks draft claiming 'actively monitoring your vitals in real time'", () => {
      const draft = "Our staff is actively monitoring your vitals in real time.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_EMERGENCY_MONITORING_IMPLICATION");
      expect(res.offendingSpan?.text).toMatch(/actively monitoring/i);
    });

    it("blocks draft claiming continuous 24/7 telemetry surveillance", () => {
      const draft = "Your device has real-time telemetry connected to our clinic.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_EMERGENCY_MONITORING_IMPLICATION");
      expect(res.offendingSpan?.text).toMatch(/real-time telemetry/i);
    });

    it("blocks draft stating 'if your heart stops we will be alerted'", () => {
      const draft = "Rest assured that if your heart stops we will be alerted immediately.";
      const res = stepCheckDraftSafety(draft, context);
      expect(res.blocked).toBe(true);
      expect(res.violationCode).toBe("NO_EMERGENCY_MONITORING_IMPLICATION");
    });
  });
});

describe("Deterministic Draft Safety Checker — Documentation Verification", () => {
  it("verifies that the 'known gaps' doc exists and documents checker limitations", () => {
    const docPath = path.resolve(__dirname, "..", "docs", "draft-checker-known-gaps.md");
    expect(fs.existsSync(docPath), `Known gaps documentation must exist at ${docPath}`).toBe(true);

    const docContent = fs.readFileSync(docPath, "utf-8");
    // Verify core documented structural limitations
    expect(docContent).toContain("Creative Metaphors");
    expect(docContent).toContain("Sarcasm");
    expect(docContent).toContain("Counterfactuals");
    expect(docContent).toContain("Emergent Brand Names");
    expect(docContent).toContain("Multi-Session");
    expect(docContent).toContain("Strategic Omission");
    expect(docContent).toContain("Defense-in-Depth");
  });
});

