import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        paper: "#FAF9F4",
        paper2: "#F4F2EA",
        ink: "#111714",
        mute: "#6B7268",
        mute2: "#9AA098",
        line: "#E5E2D9",
        line2: "#EFEDE5",
        field: "#F6F4EC",
        moss: "#4F7A5C",
        mossSoft: "#E5EDE3",
        amber: "#B07A2C",
        amberSoft: "#F5EAD3",
        // Legacy aliases for any other components that referenced the
        // earlier palette — safe to remove once nothing imports them.
        action: "#111714",
        success: "#4F7A5C",
        warning: "#B07A2C",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(17, 23, 20, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
