/**
 * Local Storage Utilities.
 * PERMANENT RULE: localStorage is used ONLY for client-side UI preferences (e.g. theme, layout).
 * SQLite via tRPC is the sole source of truth for all business data.
 */

const THEME_PREFERENCE_KEY = "careflow-ui-theme";
const FILTER_PREFERENCE_KEY = "careflow-ui-filter-preference";

export function loadThemePreference(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(THEME_PREFERENCE_KEY);
  } catch {
    return null;
  }
}

export function saveThemePreference(theme: string): void {
  try {
    window.localStorage.setItem(THEME_PREFERENCE_KEY, theme);
  } catch {
    // UI preferences remain non-critical
  }
}

export function loadFilterPreference(): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FILTER_PREFERENCE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveFilterPreference(pref: Record<string, string>): void {
  try {
    window.localStorage.setItem(FILTER_PREFERENCE_KEY, JSON.stringify(pref));
  } catch {
    // UI preference only
  }
}
