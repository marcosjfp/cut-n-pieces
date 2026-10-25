const { test } = require('node:test');
const assert = require('node:assert/strict');
const { optimize, validate, partition } = require('../optimizer.js');
const job = (overrides = {}) => ({ sheet: { width: 2400, height: 1200, quantity: 1 }, parts: [{ id: 0, width: 1000, height: 500, quantity: 2 }, { id: 1, width: 600, height: 400, quantity: 3 }], kerf: 3, trim: 0, mode: 'order', rotateParts: true, ...overrides });
const close = (a, b) => assert.ok(Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-8, `${a} != ${b}`);
function verify(result, data) {
  const counts = new Map();
  result.sheets.forEach(s => {
    const pieces = s.placements;
    for (const [i, p] of pieces.entries()) {
      const original = data.parts.find(v => v.id === p.partId);
      close(p.width, p.rotated ? original.height : original.width);
      close(p.height, p.rotated ? original.width : original.height);
      if (!data.rotateParts) assert.equal(p.rotated, false);
      assert.ok(p.x >= data.trim - 1e-7 && p.y >= data.trim - 1e-7);
      assert.ok(p.x + p.width <= data.sheet.width - data.trim + 1e-7);
      assert.ok(p.y + p.height <= data.sheet.height - data.trim + 1e-7);
      counts.set(p.partId, (counts.get(p.partId) || 0) + 1);
      for (const q of pieces.slice(i + 1)) {
        assert.ok(p.x + p.width + data.kerf <= q.x + 1e-7 || q.x + q.width + data.kerf <= p.x + 1e-7 || p.y + p.height + data.kerf <= q.y + 1e-7 || q.y + q.height + data.kerf <= p.y + 1e-7, 'overlap or missing blade clearance');
      }
    }
    const usableArea = (data.sheet.width - 2 * data.trim) * (data.sheet.height - 2 * data.trim);
    close(s.usedArea + s.kerfArea + s.remnants.reduce((sum, r) => sum + r.width * r.height, 0), usableArea);
    // Replay every cut against the currently available physical rectangles.
    const free = [{ x: data.trim, y: data.trim, width: data.sheet.width - 2 * data.trim, height: data.sheet.height - 2 * data.trim }];
    for (const c of s.cuts) {
      const i = free.findIndex(r => ['x', 'y', 'width', 'height'].every(k => Math.abs(r[k] - c.rect[k]) < 1e-6));
      assert.ok(i >= 0, 'cut references a rectangle not yet available');
      const r = free.splice(i, 1)[0], dimension = c.axis === 'x' ? 'width' : 'height';
      const finished = { ...r, [dimension]: c.offset };
      free.push(finished);
      if (r[dimension] - c.offset - c.kerf > 1e-7) free.push({ ...r, [c.axis]: r[c.axis] + c.offset + c.kerf, [dimension]: r[dimension] - c.offset - c.kerf });
    }
    for (const p of [...pieces, ...s.remnants]) {
      const i = free.findIndex(r => ['x', 'y', 'width', 'height'].every(k => Math.abs(r[k] - p[k]) < 1e-6));
      assert.ok(i >= 0, 'finished piece or offcut missing from executable cut sequence'); free.splice(i, 1);
    }
    assert.equal(free.length, 0);
  });
  close([...counts.values()].reduce((s, n) => s + n, 0), result.count);
  if (data.mode === 'order') data.parts.forEach(p => assert.equal((counts.get(p.id) || 0) + result.remaining[p.id], p.quantity));
}
test('sample order fits and has executable cuts', () => { const d = job(); const r = optimize(d); assert.equal(r.count, 5); verify(r, d); });
test('exact sheet size requires no cut and no phantom kerf', () => {
  const d = job({ parts: [{ id: 0, width: 2400, height: 1200, quantity: 1 }] }); const r = optimize(d);
  assert.equal(r.count, 1); assert.equal(r.sheets[0].cuts.length, 0); assert.equal(r.sheets[0].kerfArea, 0); verify(r, d);
});
test('kerf prevents an otherwise exact pair from fitting', () => {
  const d = job({ sheet: { width: 1000, height: 500, quantity: 1 }, parts: [{ id: 0, width: 500, height: 500, quantity: 2 }], rotateParts: false });
  assert.equal(optimize(d).count, 1); d.kerf = 0; assert.equal(optimize(d).count, 2); verify(optimize(d), d);
});
test('kerf can exit the stock edge without taking material from finished piece', () => {
  const d = job({ sheet: { width: 101, height: 101, quantity: 1 }, parts: [{ id: 0, width: 100, height: 100, quantity: 1 }], kerf: 3 }); const r = optimize(d);
  assert.equal(r.count, 1); assert.equal(r.sheets[0].kerfArea, 201); verify(r, d);
});
test('rotation lock cannot be bypassed by turning the sheet', () => {
  const d = job({ sheet: { width: 100, height: 200, quantity: 1 }, parts: [{ id: 0, width: 200, height: 100, quantity: 1 }], rotateParts: false });
  assert.equal(optimize(d).count, 0); d.rotateParts = true; const r = optimize(d); assert.equal(r.count, 1); verify(r, d);
});
test('plans additional sheets only as needed and reports shortages', () => {
  const d = job({ sheet: { width: 100, height: 100, quantity: 3 }, parts: [{ id: 0, width: 100, height: 100, quantity: 2 }] });
  let r = optimize(d); assert.equal(r.sheets.length, 2); assert.equal(r.count, 2); verify(r, d);
  d.parts[0].quantity = 4; r = optimize(d); assert.equal(r.count, 3); assert.equal(r.remaining[0], 1); verify(r, d);
});
test('edge trim reduces usable sheet and reports oversized pieces', () => {
  const d = job({ trim: 20, parts: [{ id: 0, width: 2400, height: 1200, quantity: 1 }] });
  const r = optimize(d); assert.deepEqual(r.impossible, [0]); assert.equal(r.count, 0);
});
test('capacity finds quantity on one sheet and ignores entered quantity', () => {
  const d = job({ sheet: { width: 1000, height: 1000, quantity: 9 }, parts: [{ id: 0, width: 250, height: 250, quantity: 1 }], kerf: 0, mode: 'capacity' });
  const r = optimize(d); assert.equal(r.count, 16); assert.equal(r.sheets.length, 1); verify(r, d);
  d.kerf = 3; const withKerf = optimize(d); assert.equal(withKerf.count, 9); verify(withKerf, d);
});
test('capacity includes mixed rotations when they improve quantity', () => {
  const d = job({ sheet: { width: 100, height: 100, quantity: 1 }, parts: [{ id: 0, width: 60, height: 40, quantity: 1 }], kerf: 0, mode: 'capacity' });
  const r = optimize(d); assert.equal(r.count, 3); verify(r, d);
});
test('rejects invalid inputs and work beyond limits', () => {
  for (const d of [job({ kerf: NaN }), job({ trim: 600 }), job({ parts: [] }), job({ parts: [{ id: 0, width: 0, height: 2, quantity: 1 }] }), job({ sheet: { width: Infinity, height: 1, quantity: 1 } }), job({ parts: [{ id: 0, width: 2, height: 2, quantity: 1.5 }] }), job({ mode: 'capacity' }), job({ mode: 'capacity', parts: [{ id: 0, width: 1, height: 1, quantity: 1 }] })]) assert.throws(() => validate(d));
});
test('decimal dimensions preserve clearance and area', () => {
  const d = job({ sheet: { width: 1200.5, height: 700.25, quantity: 2 }, parts: [{ id: 0, width: 199.75, height: 100.125, quantity: 30 }], kerf: 1.25, trim: 4.5 }); verify(optimize(d), d);
});
test('100 deterministic mixed-size jobs have no overlap, conserve area and replay all cuts', () => {
  let seed = 183;
  const random = max => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; };
  for (let n = 0; n < 100; n++) {
    const d = job({ sheet: { width: 400 + random(1500), height: 400 + random(1500), quantity: 1 + random(3) },
      parts: Array.from({ length: 1 + random(6) }, (_, id) => ({ id, width: 50 + random(700), height: 50 + random(700), quantity: 1 + random(12) })), kerf: random(8), trim: random(10), rotateParts: !!random(2) });
    verify(optimize(d), d);
  }
});
