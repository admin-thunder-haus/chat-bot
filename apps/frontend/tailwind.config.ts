import type { Config } from 'tailwindcss';

/**
 * Thunder.AI brand tokens.
 *
 * Components reference `brand-*`, never a raw hex and never a stock Tailwind
 * blue, so the palette can be retuned in one place. The scale is built around
 * the logo's electric blue (`brand-500`), and the darker steps exist for a
 * specific reason: white text on `brand-500` does not clear the 4.5:1 contrast
 * floor, so anything carrying text uses `brand-600` or darker while the bright
 * end is reserved for marks, glows and accents where nothing has to be read.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#ECF7FF',
          100: '#D3EDFF',
          200: '#AFE0FF',
          300: '#78CDFF',
          400: '#3AB4FC',
          // The logo blue. Accents and marks only — too light for white text.
          500: '#159BF0',
          // Primary actions. Clears AA with white text.
          600: '#0B72C4',
          700: '#0B5C9F',
          800: '#0E4C81',
          900: '#11406B',
          // The logo's backdrop: near-black with a navy cast.
          950: '#060B16',
        },
      },
    },
  },
  plugins: [],
};

export default config;
