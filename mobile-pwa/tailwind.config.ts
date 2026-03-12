import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        approve: "var(--color-approve)",
        reject: "var(--color-reject)",
        modify: "var(--color-modify)",
        "risk-low": "var(--color-risk-low)",
        "risk-medium": "var(--color-risk-medium)",
        "risk-high": "var(--color-risk-high)",
        "risk-critical": "var(--color-risk-critical)",
        "bg-primary": "var(--color-bg-primary)",
        "bg-secondary": "var(--color-bg-secondary)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
      },
      borderRadius: {
        card: "var(--card-border-radius)",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
