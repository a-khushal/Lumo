import sharedConfig from "@repo/tailwind-config/web";

/** @type {import('tailwindcss').Config} */
const config = {
  presets: [sharedConfig],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/**/*.{js,ts,jsx,tsx,mdx}",
  ],
};

export default config;
