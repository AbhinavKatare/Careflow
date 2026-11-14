/**
 * Careflow Voice Simulation Audio Engine
 * Client-side speech synthesis and audio simulation for /voice-sim.
 * Uses the Web Speech API (window.speechSynthesis) with Web Audio API fallbacks.
 */

export interface PlayVoiceOptions {
  text: string;
  role?: "agent" | "patient";
  bargeInAfterMs?: number;
  rate?: number;
  pitch?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onBargeIn?: () => void;
  onError?: (err: unknown) => void;
}

let _activeUtterance: SpeechSynthesisUtterance | null = null;
let activeBargeInTimeout: ReturnType<typeof setTimeout> | null = null;

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Stop any current speech or audio playback immediately.
 */
export function stopVoiceAudio(): void {
  if (activeBargeInTimeout) {
    clearTimeout(activeBargeInTimeout);
    activeBargeInTimeout = null;
  }
  if (isSpeechSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
  _activeUtterance = null;
}

/**
 * Synthesizes and plays spoken text through the browser's speech engine.
 * Supports configurable barge-in timeouts to simulate interruption mid-sentence.
 */
export function playVoiceAudio(options: PlayVoiceOptions): boolean {
  stopVoiceAudio();

  const {
    text,
    role = "agent",
    bargeInAfterMs,
    rate = 1.05,
    pitch,
    onStart,
    onEnd,
    onBargeIn,
    onError,
  } = options;

  if (!text || text.trim().length === 0) {
    return false;
  }

  if (!isSpeechSupported()) {
    // Fallback: Web Audio synth tone if SpeechSynthesis is not supported
    playFallbackChime(role === "agent" ? 440 : 550, 400);
    onStart?.();
    setTimeout(() => onEnd?.(), 400);
    return true;
  }

  try {
    const utterance = new SpeechSynthesisUtterance(text);
    _activeUtterance = utterance;

    // Set voice properties
    utterance.rate = rate;
    utterance.pitch = pitch ?? (role === "agent" ? 1.0 : 1.15);

    // Pick appropriate voice if available
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      if (role === "agent") {
        // Prefer natural, smooth English voices for agent
        const agentVoice = voices.find(
          (v) =>
            v.lang.startsWith("en") &&
            (v.name.includes("Natural") ||
              v.name.includes("Google") ||
              v.name.includes("Zira") ||
              v.name.includes("Jenny") ||
              v.name.includes("Samantha"))
        ) || voices.find((v) => v.lang.startsWith("en"));
        if (agentVoice) utterance.voice = agentVoice;
      } else {
        // Patient voice
        const patientVoice = voices.find(
          (v) =>
            v.lang.startsWith("en") &&
            (v.name.includes("David") ||
              v.name.includes("Guy") ||
              v.name.includes("Alex") ||
              v.name.includes("George"))
        ) || voices.find((v) => v.lang.startsWith("en"));
        if (patientVoice) utterance.voice = patientVoice;
      }
    }

    utterance.onstart = () => {
      onStart?.();

      // If barge-in simulation is configured, interrupt playback mid-sentence
      if (bargeInAfterMs && bargeInAfterMs > 0) {
        activeBargeInTimeout = setTimeout(() => {
          stopVoiceAudio();
          onBargeIn?.();
        }, bargeInAfterMs);
      }
    };

    utterance.onend = () => {
      if (activeBargeInTimeout) {
        clearTimeout(activeBargeInTimeout);
        activeBargeInTimeout = null;
      }
      _activeUtterance = null;
      onEnd?.();
    };

    utterance.onerror = (e) => {
      if (activeBargeInTimeout) {
        clearTimeout(activeBargeInTimeout);
        activeBargeInTimeout = null;
      }
      _activeUtterance = null;
      // "canceled" or "interrupted" is expected on barge-in
      if (e.error !== "canceled" && e.error !== "interrupted") {
        onError?.(e);
      }
    };

    // Keep reference on window to prevent premature V8 garbage collection
    (window as unknown as { __careflow_active_speech?: unknown }).__careflow_active_speech = utterance;

    window.speechSynthesis.speak(utterance);
    return true;
  } catch (err) {
    playFallbackChime(role === "agent" ? 440 : 550, 400);
    onError?.(err);
    return false;
  }
}

/**
 * Clean Web Audio tone fallback in case SpeechSynthesis is muted or unavailable.
 */
function playFallbackChime(frequency: number, durationMs: number): void {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  } catch {
    // Audio context may be restricted by autoplay policy; silent no-op
  }
}
