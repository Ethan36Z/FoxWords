// Appearance preferences (theme + font size). Stored per browser in
// localStorage and applied as data attributes on <html>, which global.css
// reads. index.html runs the same logic inline before the first paint.

const KEY = "foxwords_appearance";

export const THEMES = ["light", "dark", "eye"];
export const FONT_SIZES = ["sm", "md", "lg", "xl"];

export const DEFAULT_APPEARANCE = { theme: "light", followSystem: true, fontSize: "md" };

export function loadAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      theme: THEMES.includes(saved.theme) ? saved.theme : DEFAULT_APPEARANCE.theme,
      followSystem:
        typeof saved.followSystem === "boolean" ? saved.followSystem : DEFAULT_APPEARANCE.followSystem,
      fontSize: FONT_SIZES.includes(saved.fontSize) ? saved.fontSize : DEFAULT_APPEARANCE.fontSize,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function systemPrefersDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

// The theme actually on screen right now
export function effectiveTheme(a) {
  if (a.followSystem) return systemPrefersDark() ? "dark" : "light";
  return a.theme;
}

export function applyAppearance(a) {
  const root = document.documentElement;
  // No data-theme attribute = follow the system light/dark setting in CSS
  if (a.followSystem) delete root.dataset.theme;
  else root.dataset.theme = a.theme;
  root.dataset.fontSize = a.fontSize;

  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute("content", bg);
}

export function saveAppearance(a) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    // Private mode etc.: still applied for this visit
  }
  applyAppearance(a);
}
