/** @type {import('tailwindcss').Config} */
// Theming is handled at runtime via the DARK_S / LIGHT_S objects in src/App.tsx
// (inline styles), so Tailwind here only provides the base reset in index.css.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
}
