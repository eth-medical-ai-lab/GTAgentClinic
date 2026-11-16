// Vite replaces MODE at build time. The downloaded game keeps its normal server-backed entry.
export const browserDemo = import.meta.env.MODE === 'demo';
export const touchTour = () =>
  window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && window.matchMedia('(hover: none)').matches);
