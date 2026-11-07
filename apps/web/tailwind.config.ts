import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Cores do TEMA: valores em src/app/globals.css (variáveis por data-palette).
        // moss é sinônimo histórico de brand.
        moss: {
          50: 'rgb(var(--c-brand-50) / <alpha-value>)',
          100: 'rgb(var(--c-brand-100) / <alpha-value>)',
          200: 'rgb(var(--c-brand-200) / <alpha-value>)',
          300: 'rgb(var(--c-brand-300) / <alpha-value>)',
          400: 'rgb(var(--c-brand-400) / <alpha-value>)',
          500: 'rgb(var(--c-brand-500) / <alpha-value>)',
          600: 'rgb(var(--c-brand-600) / <alpha-value>)',
          700: 'rgb(var(--c-brand-700) / <alpha-value>)',
          800: 'rgb(var(--c-brand-800) / <alpha-value>)',
          900: 'rgb(var(--c-brand-900) / <alpha-value>)',
        },
        brand: {
          50: 'rgb(var(--c-brand-50) / <alpha-value>)',
          100: 'rgb(var(--c-brand-100) / <alpha-value>)',
          200: 'rgb(var(--c-brand-200) / <alpha-value>)',
          300: 'rgb(var(--c-brand-300) / <alpha-value>)',
          400: 'rgb(var(--c-brand-400) / <alpha-value>)',
          500: 'rgb(var(--c-brand-500) / <alpha-value>)',
          600: 'rgb(var(--c-brand-600) / <alpha-value>)',
          700: 'rgb(var(--c-brand-700) / <alpha-value>)',
          800: 'rgb(var(--c-brand-800) / <alpha-value>)',
          900: 'rgb(var(--c-brand-900) / <alpha-value>)',
        },
        forest: {
          900: 'rgb(var(--c-forest-900) / <alpha-value>)',
          950: 'rgb(var(--c-forest-950) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: [
          'Geist',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['Geist Mono', 'JetBrains Mono', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        // M3 emphasizedDecelerate, 180ms: entrada de menu (fade + scale).
        'menu-in': 'menuIn 180ms cubic-bezier(0.05, 0.7, 0.1, 1)',
        'fade-in-fast': 'fadeIn 120ms linear',
        // Indicador de fala: halo que pulsa em volta do avatar + barrinhas.
        'speak-pulse': 'speakPulse 1.1s ease-out infinite',
        'eq-bar': 'eqBar 0.7s ease-in-out infinite',
        // Tela de chamada: ondas saindo do avatar + telefone balancando.
        'call-ripple': 'callRipple 2.4s ease-out infinite',
        'call-shake': 'callShake 1.2s ease-in-out infinite',
      },
      keyframes: {
        callRipple: {
          '0%': { transform: 'scale(1)', opacity: '0.55' },
          '100%': { transform: 'scale(2.3)', opacity: '0' },
        },
        callShake: {
          '0%, 50%, 100%': { transform: 'rotate(0deg)' },
          '10%, 30%': { transform: 'rotate(-14deg)' },
          '20%, 40%': { transform: 'rotate(14deg)' },
        },
        speakPulse: {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--c-brand-400) / 0.65)' },
          '70%': { boxShadow: '0 0 0 12px rgb(var(--c-brand-400) / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(var(--c-brand-400) / 0)' },
        },
        eqBar: {
          '0%, 100%': { transform: 'scaleY(0.3)' },
          '50%': { transform: 'scaleY(1)' },
        },
        menuIn: {
          '0%': { opacity: '0', transform: 'scale(0.95) translateY(-4px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
