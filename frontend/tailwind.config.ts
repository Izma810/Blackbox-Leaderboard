import type { Config } from 'tailwindcss'

export default {
  // relative: resolve these globs from this file, not from wherever Vite was started
  content: { relative: true, files: ['./index.html', './src/**/*.{ts,tsx}'] },
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Poppins', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        paper: '#F5F2EA',
        line:  '#E4DFD3',
        ink: {
          DEFAULT: '#17150F',
          2: '#3E3A32',
          3: '#6B665B',
          4: '#9C968A',
        },
        accent: {
          DEFAULT: '#FF6A2B',
          dark:    '#E5531A',
          soft:    '#FFE7DB',
        },
        up: {
          DEFAULT: '#138A5A',
          soft:    '#DCF2E7',
        },
        down: {
          DEFAULT: '#D93A40',
          soft:    '#FBE1E1',
        },
        cobalt: {
          DEFAULT: '#3355E8',
          soft:    '#E3E8FD',
        },
      },
      boxShadow: {
        pop:      '3px 3px 0 0 #17150F',
        'pop-lg': '5px 5px 0 0 #17150F',
        soft:     '0 1px 2px rgba(23,21,15,0.06), 0 8px 24px -12px rgba(23,21,15,0.18)',
      },
      animation: {
        'fade-in':  'fadeIn 0.25s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
        'pop-in':   'popIn 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)',
        flash:      'flash 1.2s ease-out',
        // Round intro / standings reveal
        'count-pop': 'countPop 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2) both',
        'rise':      'rise 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'stamp':     'stamp 0.4s cubic-bezier(0.3, 1.6, 0.5, 1) both',
        'nudge-up':  'nudgeUp 0.6s ease-out 2',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        popIn:   { '0%': { opacity: '0', transform: 'scale(0.96)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        flash:   { '0%, 40%': { boxShadow: '0 0 0 4px rgba(255,106,43,0.55)' }, '100%': { boxShadow: '0 0 0 0 rgba(255,106,43,0)' } },
        countPop: {
          '0%':   { opacity: '0', transform: 'scale(2.2)' },
          '60%':  { opacity: '1', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        rise:    { from: { opacity: '0', transform: 'translateY(24px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        stamp:   { '0%': { opacity: '0', transform: 'scale(0.4) rotate(-8deg)' }, '100%': { opacity: '1', transform: 'scale(1) rotate(0)' } },
        nudgeUp: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-3px)' } },
      },
    },
  },
  plugins: [],
} satisfies Config
