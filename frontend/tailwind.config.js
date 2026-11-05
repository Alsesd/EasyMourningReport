/**
 * «Книга обліку» design tokens. Colours are CSS custom properties defined in src/app/index.css
 * (light and dark). Tailwind cannot apply opacity modifiers such as `bg-primary/10` to a plain
 * `var(--primary)`, so every token goes through `token()`, which mixes in transparency.
 */
const token = (name) => ({ opacityValue }) =>
  opacityValue === undefined || opacityValue === "1"
    ? `var(${name})`
    : `color-mix(in srgb, var(${name}) calc(${opacityValue} * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Paper and ink
        page: token("--page"),
        surface: token("--surface"),
        "surface-raised": token("--surface-raised"),
        "text-main": token("--text"),
        "text-muted": token("--muted-text"),
        border: token("--border"),
        ink: token("--ink-rule"),
        // Spruce: the brand and every primary action
        primary: {
          DEFAULT: token("--primary"),
          fg: token("--primary-fg"),
          hover: token("--primary-hover"),
          soft: token("--primary-soft"),
        },
        // Beeswax amber: only for what needs attention (not submitted, unsaved, warnings)
        attention: {
          DEFAULT: token("--attention"),
          soft: token("--attention-soft"),
        },
        destructive: {
          DEFAULT: token("--destructive"),
          fg: token("--destructive-fg"),
          hover: token("--destructive-hover"),
        },
        // Kept for existing components; they map onto the ledger palette.
        accent: {
          DEFAULT: token("--attention"),
          soft: token("--attention-soft"),
          cool: token("--primary"),
          "cool-soft": token("--primary-soft"),
        },
        pill: {
          "sent-bg": token("--primary-soft"),
          "sent-text": token("--primary"),
          "draft-bg": token("--surface-raised"),
          "draft-text": token("--muted-text"),
          "none-bg": token("--attention-soft"),
          "none-text": token("--attention"),
        },
      },
      borderRadius: {
        card: "6px",
        control: "4px",
      },
      boxShadow: {
        // Paper does not float: panels sit flat on the page, only overlays cast a shadow.
        card: "none",
        "card-hover": "none",
        overlay: "0 18px 48px rgba(16, 28, 26, 0.18)",
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        // Book serif for headings and every figure (money, quantities, months).
        serif: ["Literata", "Georgia", "serif"],
        // `font-mono` marks figures that must line up; they are set in the book serif with tabular
        // lining numerals (see index.css), never in a typewriter face.
        mono: ["Literata", "Georgia", "serif"],
      },
      minHeight: { touch: "44px" },
      minWidth: { touch: "44px" },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        fadeOut: { "0%": { opacity: "1" }, "100%": { opacity: "0" } },
        slideDown: {
          "0%": { opacity: "0", transform: "translateY(-4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        dialogShow: {
          "0%": { opacity: "0", transform: "translate(-50%, -48%)" },
          "100%": { opacity: "1", transform: "translate(-50%, -50%)" },
        },
        dialogHide: {
          "0%": { opacity: "1", transform: "translate(-50%, -50%)" },
          "100%": { opacity: "0", transform: "translate(-50%, -48%)" },
        },
      },
      animation: {
        "fade-in": "fadeIn 0.18s ease-out",
        "fade-out": "fadeOut 0.15s ease-in forwards",
        "slide-down": "slideDown 0.18s ease-out",
        "slide-up": "fadeIn 0.18s ease-out",
        "scale-in": "fadeIn 0.18s ease-out",
        "scale-out": "fadeOut 0.15s ease-in forwards",
        "dialog-show": "dialogShow 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "dialog-hide": "dialogHide 0.15s ease-in forwards",
      },
    },
  },
  plugins: [],
};
