/**
 * Check-In Workflow Pipeline module barrel export.
 * Sequence: validate -> sanitize/redact -> extract -> policy -> draft -> draft_check -> persist -> audit.
 * PERMANENT RULE: Never log prompts or raw patient responses. Zero outbound actions.
 */

export * from "./types";
export * from "./tracing";
export * from "./validate";
export * from "./redact";
export * from "./extract";
export * from "./policy";
export * from "./draft";
export * from "./draft-check";
export * from "./persist";
export * from "./audit";
export * from "./runner";
export { MockAdapter } from "../llm/mock-adapter";

