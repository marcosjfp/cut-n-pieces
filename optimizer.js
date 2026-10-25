/* Dependency-free rectangular guillotine planner. Also usable from Node for verification. */
(function (root) {
  'use strict';
  const EPS = 1e-7;
  const LIMIT = 2000;
  function validate(data) {
    const positive = v => Number.isFinite(v) && v > 0 && v <= 1e7;
    if (!data || !data.sheet || !positive(data.sheet.width) || !positive(data.sheet.height)) throw new Error('Enter sheet dimensions greater than zero (up to 10,000,000 mm).');
    if (!Number.isInteger(data.sheet.quantity) || data.sheet.quantity < 1 || data.sheet.quantity > 100) throw new Error('Available sheets must be a whole number from 1 to 100.');
    if (!Number.isFinite(data.kerf) || data.kerf < 0 || data.kerf > 1e7) throw new Error('Blade width must be zero or greater.');
    if (!Number.isFinite(data.trim) || data.trim < 0 || 2 * data.trim >= Math.min(data.sheet.width, data.sheet.height)) throw new Error('Edge trim must leave a usable area inside the sheet.');
    if (!['order', 'capacity'].includes(data.mode)) throw new Error('Choose a valid planning mode.');
    if (!Array.isArray(data.parts) || !data.parts.length || data.parts.length > 50) throw new Error('Add between 1 and 50 piece sizes.');
    if (new Set(data.parts.map(p => p.id)).size !== data.parts.length) throw new Error('Each piece size needs a unique ID.');
    for (const [i, p] of data.parts.entries()) {
      if (!positive(p.width) || !positive(p.height)) throw new Error(`Piece ${i + 1}: enter a width and height greater than zero.`);
      if (!Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > LIMIT) throw new Error(`Piece ${i + 1}: quantity must be a whole number from 1 to ${LIMIT.toLocaleString('en-US')}.`);
    }
    if (data.mode === 'capacity' && data.parts.length !== 1) throw new Error('Use one piece size for “How many fit?”. Remove the other sizes or choose “Cut an order”.');
    if (data.mode === 'order' && data.parts.reduce((s, p) => s + p.quantity, 0) > LIMIT) throw new Error(`An order can contain up to ${LIMIT.toLocaleString('en-US')} pieces.`);
    if (data.mode === 'capacity') {
      const p = data.parts[0], w = data.sheet.width - 2 * data.trim, h = data.sheet.height - 2 * data.trim;
      if (Math.floor((w * h + EPS) / (p.width * p.height)) > LIMIT) throw new Error('This capacity plan may exceed 2,000 pieces. Use a smaller sheet or larger pieces.');
    }
    return data;
  }
  function fits(p, width, height, rotate) {
    return (p.width <= width + EPS && p.height <= height + EPS) ||
      (rotate && p.height <= width + EPS && p.width <= height + EPS);
  }
  // Each split spans its current rectangle. Its offcuts are disjoint and remain usable.
  // Kerf lies outside the finished part, clipped at the outer edge of that rectangle.
  function partition(rect, width, height, kerf, verticalFirst) {
    const remnants = [], cuts = [];
    let current = { ...rect };
    for (const axis of verticalFirst ? ['x', 'y'] : ['y', 'x']) {
      const size = axis === 'x' ? width : height;
      const dimension = axis === 'x' ? 'width' : 'height';
      const other = axis === 'x' ? 'height' : 'width';
      const extra = current[dimension] - size;
      if (extra > EPS) {
        const band = Math.min(kerf, extra);
        cuts.push({ axis, x: current.x + (axis === 'x' ? size : 0), y: current.y + (axis === 'y' ? size : 0),
          length: current[other], kerf: band, offset: size, rect: { ...current } });
        if (extra - band > EPS) {
          const rest = { ...current, [dimension]: extra - band };
          rest[axis] += size + band;
          remnants.push(rest);
        }
        current[dimension] = size;
      }
    }
    return { remnants, cuts };
  }
  const sorters = {
    area: (a, b) => b.width * b.height - a.width * a.height || b.width - a.width,
    side: (a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height) || b.width * b.height - a.width * a.height,
    width: (a, b) => b.width - a.width || b.height - a.height,
    height: (a, b) => b.height - a.height || b.width - a.width
  };
  function packSheet(data, remaining, order, split) {
    const w = data.sheet.width - 2 * data.trim, h = data.sheet.height - 2 * data.trim;
    const free = [{ x: data.trim, y: data.trim, width: w, height: h }], placements = [], cuts = [];
    const parts = data.parts.slice().sort(sorters[order]);
    for (const p of parts) {
      while (remaining.get(p.id) > 0) {
        let best;
        for (let i = 0; i < free.length; i++) {
          const r = free[i];
          for (const rotated of data.rotateParts && p.width !== p.height ? [false, true] : [false]) {
            const width = rotated ? p.height : p.width, height = rotated ? p.width : p.height;
            if (width > r.width + EPS || height > r.height + EPS) continue;
            const dx = Math.max(0, r.width - width), dy = Math.max(0, r.height - height);
            const verticalFirst = split === 'vertical' || (split === 'adaptive' && dx * r.height >= dy * r.width);
            const score = [Math.min(dx, dy), Math.max(dx, dy), r.y, r.x];
            if (!best || score.some((v, j) => v < best.score[j] - EPS && score.slice(0, j).every((n, k) => Math.abs(n - best.score[k]) <= EPS))) {
              best = { i, r, width, height, rotated, verticalFirst, score };
            }
          }
        }
        if (!best) break;
        const division = partition(best.r, best.width, best.height, data.kerf, best.verticalFirst);
        free.splice(best.i, 1, ...division.remnants);
        placements.push({ x: best.r.x, y: best.r.y, width: best.width, height: best.height, rotated: best.rotated, partId: p.id });
        cuts.push(...division.cuts);
        remaining.set(p.id, remaining.get(p.id) - 1);
      }
    }
    return { placements, cuts, remnants: free, usedArea: placements.reduce((s, p) => s + p.width * p.height, 0), kerfArea: cuts.reduce((s, c) => s + c.length * c.kerf, 0) };
  }
  function optimize(input) {
    const data = validate(input);
    const width = data.sheet.width - 2 * data.trim, height = data.sheet.height - 2 * data.trim;
    const impossible = data.parts.filter(p => !fits(p, width, height, data.rotateParts)).map(p => p.id);
    let best;
    for (const order of Object.keys(sorters)) {
      for (const split of ['vertical', 'horizontal', 'adaptive']) {
        const remaining = new Map(data.parts.map(p => [p.id, data.mode === 'capacity' ? LIMIT : p.quantity]));
        const sheets = [];
        const sheetCount = data.mode === 'capacity' ? 1 : data.sheet.quantity;
        for (let i = 0; i < sheetCount; i++) {
          if (![...remaining.values()].some(n => n > 0)) break;
          const sheet = packSheet(data, remaining, order, split);
          if (!sheet.placements.length) break;
          sheets.push(sheet);
        }
        const count = sheets.reduce((s, v) => s + v.placements.length, 0);
        const area = sheets.reduce((s, v) => s + v.usedArea, 0);
        const cutCount = sheets.reduce((s, v) => s + v.cuts.length, 0);
        const cutLength = sheets.reduce((sum, sheet) => sum + sheet.cuts.reduce((length, cut) => length + cut.length, 0), 0);
        const candidate = { sheets, count, area, cutCount, cutLength, remaining: Object.fromEntries(remaining), impossible };
        if (!best || count > best.count || (count === best.count && (sheets.length < best.sheets.length ||
          (sheets.length === best.sheets.length && (area > best.area + EPS || (Math.abs(area - best.area) < EPS && (cutCount < best.cutCount || (cutCount === best.cutCount && cutLength < best.cutLength)))))))) best = candidate;
      }
    }
    best.total = data.mode === 'capacity' ? best.count : data.parts.reduce((s, p) => s + p.quantity, 0);
    return best;
  }
  const api = { optimize, validate, partition, fits, LIMIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cutwise = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
