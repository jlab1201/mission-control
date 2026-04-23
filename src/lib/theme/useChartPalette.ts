"use client";

import { useEffect, useState } from "react";
import { useTheme } from "./ThemeProvider";

export interface ChartPalette {
  accent: string;
  secondary: string;
  glow: string;
  success: string;
  warning: string;
  danger: string;
  grid: string;
  textMuted: string;
  surface: string;
  borderStrong: string;
  foreground: string;
  series: string[];
}

function readVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function readPalette(): ChartPalette {
  const accent = readVar("--accent-primary");
  const secondary = readVar("--accent-secondary");
  const glow = readVar("--accent-glow");
  const success = readVar("--success");
  const warning = readVar("--warning");
  const danger = readVar("--danger");
  const grid = readVar("--border");
  const textMuted = readVar("--text-muted");
  const surface = readVar("--surface");
  const borderStrong = readVar("--border-strong");
  const foreground = readVar("--foreground");

  return {
    accent,
    secondary,
    glow,
    success,
    warning,
    danger,
    grid,
    textMuted,
    surface,
    borderStrong,
    foreground,
    series: [accent, secondary, success, warning, danger, glow],
  };
}

const EMPTY_PALETTE: ChartPalette = {
  accent: "",
  secondary: "",
  glow: "",
  success: "",
  warning: "",
  danger: "",
  grid: "",
  textMuted: "",
  surface: "",
  borderStrong: "",
  foreground: "",
  series: [],
};

/**
 * Returns a chart palette resolved from CSS variables.
 * Re-reads whenever the theme toggles so charts recolor live without a reload.
 */
export function useChartPalette(): ChartPalette {
  const { theme } = useTheme();
  const [palette, setPalette] = useState<ChartPalette>(EMPTY_PALETTE);

  useEffect(() => {
    setPalette(readPalette());
  }, [theme]);

  return palette;
}
