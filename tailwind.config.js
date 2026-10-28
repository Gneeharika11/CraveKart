/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        crave: {
          50: '#fff5f2',
          100: '#ffe8e0',
          200: '#ffd5c7',
          300: '#ffb69e',
          400: '#ff8a65',
          500: '#f95d2b',
          600: '#e6400d',
          700: '#c13107',
          800: '#9f2b0b',
          900: '#83280f',
        },
        saffron: {
          50: '#fffbeb',
          100: '#fef3c7',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
