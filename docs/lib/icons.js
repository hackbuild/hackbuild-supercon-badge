// One small line icon per game, drawn on a 24 by 24 grid in the current text color.
const P = {
  hill: '<path d="M2 20 9 7l4 6 3-4 6 11z"/><path d="M9 7V3l3 1.5L9 6"/>',
  parts: '<rect x="7" y="7" width="10" height="10"/><path d="M10 7V3M14 7V3M10 21v-4M14 21v-4M7 10H3M7 14H3M21 10h-4M21 14h-4"/>',
  ink: '<path d="M4 20c4-1 6-4 9-8l3-3 3 3-3 3c-4 3-7 5-8 9z"/><path d="M14 8l3 3"/>',
  pixel: '<path d="M3 3h6v6H3zM15 3h6v6h-6zM9 9h6v6H9zM3 15h6v6H3zM15 15h6v6h-6z"/>',
  cinema: '<rect x="3" y="5" width="18" height="14"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  booth: '<rect x="3" y="7" width="18" height="13"/><circle cx="12" cy="13.5" r="4"/><path d="M8 7l2-3h4l2 3"/>',
  snipe: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/>',
  snake: '<path d="M3 17h6V9h6v6h6V7"/><circle cx="21" cy="5" r="1.5"/>',
  gifs: '<rect x="3" y="4" width="18" height="16"/><path d="M10 9v6l5-3z"/>',
};

export function icon(id, size = 24) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" aria-hidden="true">${P[id] || ''}</svg>`;
}
