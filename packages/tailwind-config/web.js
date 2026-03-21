const config = {
  theme: {
    extend: {
      colors: {
        canvas: "#f5f4ee",
        panel: "#ffffff",
        ink: "#1f2a37",
        muted: "#5f6d7a",
        border: "#dbe1e8",
        accent: {
          DEFAULT: "#136f63",
          strong: "#0f5a51",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      boxShadow: {
        card: "0 20px 45px -36px rgba(20, 31, 45, 0.45)",
      },
    },
  },
};

export default config;
