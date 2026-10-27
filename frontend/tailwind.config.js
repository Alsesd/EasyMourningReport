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
      boxShadow: {
        "card": "0 1px 3px 0 rgba(16, 24, 40, 0.05), 0 1px 2px -1px rgba(16, 24, 40, 0.04)",
        "card-hover": "0 4px 14px 0 rgba(16, 24, 40, 0.08), 0 2px 4px -1px rgba(16, 24, 40, 0.04)",
        "glow": "0 0 16px -2px rgba(66, 111, 157, 0.25)",
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
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        fadeOut: {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideDown: {
          "0%": { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        scaleOut: {
          "0%": { opacity: "1", transform: "scale(1)" },
          "100%": { opacity: "0", transform: "scale(0.96)" },
        },
        dialogShow: {
          "0%": { opacity: "0", transform: "translate(-50%, -48%) scale(0.96)" },
          "100%": { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
        },
        dialogHide: {
          "0%": { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
          "100%": { opacity: "0", transform: "translate(-50%, -48%) scale(0.96)" },
        },
        pulseSubtle: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "fade-out": "fadeOut 0.2s ease-in forwards",
        "slide-up": "slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-down": "slideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in": "scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-out": "scaleOut 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "dialog-show": "dialogShow 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "dialog-hide": "dialogHide 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "pulse-subtle": "pulseSubtle 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
