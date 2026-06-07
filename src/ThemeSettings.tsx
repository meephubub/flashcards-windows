import { Palette, X } from "lucide-react";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";

type ThemeSettings = {
  transparency: number;
  backgroundColor: string;
  accentColor: string;
};

const DEFAULT_THEME: ThemeSettings = {
  transparency: 45,
  backgroundColor: "#ffffff",
  accentColor: "#6366f1",
};

export function ThemeSettings({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState<ThemeSettings>(DEFAULT_THEME);

  useEffect(() => {
    const saved = localStorage.getItem("theme-settings");
    if (saved) {
      setTheme(JSON.parse(saved));
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem("theme-settings", JSON.stringify(theme));
    applyTheme(theme);
    onClose();
  };

  const applyTheme = (settings: ThemeSettings) => {
    const root = document.documentElement;
    root.style.setProperty("--theme-transparency", `${settings.transparency}%`);
    root.style.setProperty("--theme-bg-color", settings.backgroundColor);
    root.style.setProperty("--theme-accent-color", settings.accentColor);
    
    // Apply to app-shell
    const appShell = document.querySelector(".app-shell") as HTMLElement;
    if (appShell) {
      appShell.style.background = `rgba(${hexToRgb(settings.backgroundColor)}, ${settings.transparency / 100})`;
    }
  };

  const handleReset = () => {
    setTheme(DEFAULT_THEME);
    applyTheme(DEFAULT_THEME);
  };

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
      : "255, 255, 255";
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="theme-settings-panel"
    >
      <div className="theme-header">
        <div className="theme-title">
          <Palette size={20} />
          <h2>Theme Settings</h2>
        </div>
        <button onClick={onClose} className="close-btn">
          <X size={18} />
        </button>
      </div>

      <div className="theme-content">
        <div className="theme-section">
          <label className="theme-label">Transparency</label>
          <div className="theme-slider-container">
            <input
              type="range"
              min="0"
              max="100"
              value={theme.transparency}
              onChange={(e) => {
                const newTheme = { ...theme, transparency: parseInt(e.target.value) };
                setTheme(newTheme);
                applyTheme(newTheme);
              }}
              className="theme-slider"
            />
            <span className="theme-value">{theme.transparency}%</span>
          </div>
        </div>

        <div className="theme-section">
          <label className="theme-label">Background Color</label>
          <div className="theme-color-picker">
            <input
              type="color"
              value={theme.backgroundColor}
              onChange={(e) => {
                const newTheme = { ...theme, backgroundColor: e.target.value };
                setTheme(newTheme);
                applyTheme(newTheme);
              }}
              className="theme-color-input"
            />
            <span className="theme-color-hex">{theme.backgroundColor}</span>
          </div>
        </div>

        <div className="theme-section">
          <label className="theme-label">Accent Color</label>
          <div className="theme-color-picker">
            <input
              type="color"
              value={theme.accentColor}
              onChange={(e) => {
                const newTheme = { ...theme, accentColor: e.target.value };
                setTheme(newTheme);
                applyTheme(newTheme);
              }}
              className="theme-color-input"
            />
            <span className="theme-color-hex">{theme.accentColor}</span>
          </div>
        </div>

        <div className="theme-preview">
          <div
            className="theme-preview-box"
            style={{
              background: `rgba(${hexToRgb(theme.backgroundColor)}, ${theme.transparency / 100})`,
              borderColor: theme.accentColor,
            }}
          >
            <span style={{ color: theme.accentColor }}>Preview</span>
          </div>
        </div>
      </div>

      <div className="theme-footer">
        <button onClick={handleReset} className="theme-button secondary">
          Reset to Default
        </button>
        <button onClick={handleSave} className="theme-button primary">
          Save Changes
        </button>
      </div>
    </motion.div>
  );
}
