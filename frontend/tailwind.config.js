/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        page: "var(--page)",
        surface: "var(--surface)",
        "surface-raised": "var(--surface-raised)",
        "text-main": "var(--text)",
        "text-muted": "var(--muted-text)",
        border: "var(--border)",
        primary: {
          DEFAULT: "var(--primary)",
          fg: "var(--primary-fg)",
          hover: "var(--primary-hover)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          fg: "var(--destructive-fg)",
          hover: "var(--destructive-hover)",
        },
        pill: {
          "sent-bg": "var(--pill-sent-bg)",
          "sent-text": "var(--pill-sent-text)",
          "draft-bg": "var(--pill-draft-bg)",
          "draft-text": "var(--pill-draft-text)",
          "none-bg": "var(--pill-none-bg)",
          "none-text": "var(--pill-none-text)",
        },
      },
      borderRadius: {
        card: "16px",
        control: "12px",
      },
      fontFamily: {
        sans: ["Onest", "sans-serif"],
      },
      minHeight: {
        touch: "44px",
      },
      minWidth: {
        touch: "44px",
      },
    },
  },
  plugins: [],
};
