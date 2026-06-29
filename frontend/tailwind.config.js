/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          bg:       "#020617",
          surface:  "#0f172a",
          border:   "#1e293b",
          primary:  "#67e8f9",
          text:     "#a5f3fc",
          muted:    "#164e63",
          accent:   "#cffafe",
        },
      },
    },
  },
  plugins: [],
}
