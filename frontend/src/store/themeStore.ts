import { create } from "zustand";

type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

const stored = (typeof localStorage !== "undefined" && localStorage.getItem("theme")) as ThemeMode | null;
const initial: ThemeMode = stored && ["light", "dark", "system"].includes(stored) ? stored : "system";

// Apply on load
applyTheme(initial);

// Listen for system preference changes
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const current = useThemeStore.getState().mode;
    if (current === "system") applyTheme("system");
  });
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: initial,
  setMode: (mode) => {
    localStorage.setItem("theme", mode);
    applyTheme(mode);
    set({ mode });
  },
}));
