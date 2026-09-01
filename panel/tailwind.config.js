/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { wertis: { amber: "#F7A600", ink: "#2A2A2C", paper: "#F6F5F2" } },
      fontFamily: { sans: ["Barlow", "sans-serif"] },
    },
  },
  plugins: [],
};
