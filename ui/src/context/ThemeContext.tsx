import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { Theme, themes, getStoredTheme, storeTheme, applyTheme } from "../themes";

interface ThemeContextType {
  currentTheme: Theme;
  themeId: string;
  setTheme: (themeId: string) => void;
  availableThemes: Theme[];
}

const ThemeContext = createContext<ThemeContextType>({
  currentTheme: themes[0],
  themeId: themes[0].id,
  setTheme: () => {},
  availableThemes: themes,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<string>(getStoredTheme);

  const currentTheme = themes.find((t) => t.id === themeId) ?? themes[0];

  const setTheme = useCallback((id: string) => {
    const theme = themes.find((t) => t.id === id);
    if (theme) {
      setThemeId(id);
      storeTheme(id);
      applyTheme(theme);
    }
  }, []);

  // Apply theme on mount
  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  return (
    <ThemeContext.Provider value={{ currentTheme, themeId, setTheme, availableThemes: themes }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  return useContext(ThemeContext);
}


