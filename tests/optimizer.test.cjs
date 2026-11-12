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

test('material priority favors more finished metal, while quantity priority favors more pieces', () => {
  const d = job({ sheet: { width: 1000, height: 1000, quantity: 1 }, parts: [
    { id: 0, width: 900, height: 1000, quantity: 1 },
    { id: 1, width: 300, height: 300, quantity: 9 }
  ], kerf: 0, rotateParts: false });
  const material = optimize(d), pieces = optimize({ ...d, objective: 'pieces' });
  assert.equal(material.count, 1); assert.equal(material.area, 900000);
  assert.equal(pieces.count, 9); assert.equal(pieces.area, 810000);
  assert.deepEqual(material.alternative, { objective: 'pieces', count: 9, area: 810000, sheets: 1 });
  assert.equal(pieces.alternative.area, material.area);
  assert.equal(material.objective, 'material');
  verify(material, d); verify(pieces, d);
});
test('expanded rotation search fits six pieces where the old search found five', () => {
  const d = job({ sheet: { width: 500, height: 550, quantity: 1 }, parts: [{ id: 0, width: 150, height: 250, quantity: 1 }], kerf: 10, mode: 'capacity' });
  const r = optimize(d); assert.equal(r.count, 6); assert.equal(r.strategiesCompared, 54); verify(r, d);
});
test('both priorities complete the order when enough sheets are available', () => {
  const d = job({ sheet: { width: 1000, height: 1000, quantity: 2 }, parts: [{ id: 0, width: 900, height: 1000, quantity: 1 }, { id: 1, width: 300, height: 300, quantity: 9 }], kerf: 0, rotateParts: false });
  for (const objective of ['material', 'pieces']) {
    const r = optimize({ ...d, objective }); assert.equal(r.count, 10); assert.equal(r.sheets.length, 2); assert.equal(r.strategiesCompared, 18); verify(r, d);
  }
});
test('rejects unsupported objectives and does not mutate job inputs', () => {
  assert.throws(() => optimize(job({ objective: 'unknown' })), /priority/);
  const d = job(), before = JSON.stringify(d); optimize(d); assert.equal(JSON.stringify(d), before);
});

const durma = (overrides = {}) => job({ machine: 'durma-sbt-3006', kerf: 0, ...overrides });
function verifyShear(result, data) {
  verify(result, { ...data, kerf: 0 });
  const m = result.machine;
  assert.equal(m.id, 'durma-sbt-3006');
  for (const s of result.sheets) for (const c of s.cuts) {
    const dimension = c.axis === 'x' ? 'width' : 'height';
    const far = c.rect[dimension] - c.offset - c.kerf;
    assert.ok(c.length <= m.maxCutLength + 1e-7, `cut length ${c.length} exceeds blade`);
    assert.ok(c.gauge, 'every shear cut has a back-gauge setting');
    close(c.gauge.distance, c.gauge.side === 'near' ? c.offset : far);
    assert.ok(c.gauge.distance >= m.minGauge - 1e-7 && c.gauge.distance <= m.maxGauge + 1e-7, `gauge ${c.gauge.distance} out of range`);
  }
}
test('generic machine is the default and keeps kerf', () => {
  const r = optimize(job()); assert.equal(r.machine.id, 'generic');
  assert.throws(() => optimize(job({ machine: 'laser-9000' })), /machine/);
});
test('Durma SBT 3006 forces zero kerf and keeps every cut inside the 5–950 mm back gauge', () => {
  const d = durma({ kerf: 3 }), before = JSON.stringify(d);
  const r = optimize(d); assert.equal(r.count, 5); verifyShear(r, d);
  assert.equal(JSON.stringify(d), before);
  assert.ok(r.sheets.every(s => s.kerfArea === 0));
});
test('Durma shears gauge strips first when both sides of a cut exceed 950 mm', () => {
  // 1000 mm wide piece on a 2500 mm sheet: 1000 / 1500 split is out of range on both sides.
  const d = durma({ sheet: { width: 2500, height: 1000, quantity: 1 }, parts: [{ id: 0, width: 1000, height: 1000, quantity: 1 }], rotateParts: false });
  const r = optimize(d); assert.equal(r.count, 1); verifyShear(r, d);
  assert.ok(r.sheets[0].cuts.some(c => c.preparatory));
  // The generic planner makes a single cut that the shear cannot gauge.
  const generic = optimize({ ...d, machine: 'generic' });
  assert.equal(generic.sheets[0].cuts.length, 1); assert.equal(generic.sheets[0].cuts[0].offset, 1000);
});
test('Durma cannot cut slivers below 5 mm on both sides', () => {
  const d = durma({ sheet: { width: 8, height: 100, quantity: 1 }, parts: [{ id: 0, width: 4, height: 100, quantity: 2 }], rotateParts: false });
  const r = optimize(d); assert.equal(r.count, 0); assert.deepEqual(r.impossible, [0]);
  const generic = optimize({ ...d, machine: 'generic' }); assert.equal(generic.count, 2);
});
test('Durma will not plan cuts longer than its 3050 mm blade', () => {
  const d = durma({ sheet: { width: 4000, height: 4000, quantity: 1 }, parts: [{ id: 0, width: 500, height: 500, quantity: 1 }] });
  const r = optimize(d); assert.equal(r.count, 0); assert.deepEqual(r.impossible, [0]);
  const long = durma({ sheet: { width: 6000, height: 1500, quantity: 1 }, parts: [{ id: 0, width: 1000, height: 500, quantity: 6 }] });
  const lr = optimize(long); assert.ok(lr.count > 0); verifyShear(lr, long);
});
test('Durma plans 100 reproducible mixed jobs with gaugeable cuts only', () => {
  let seed = 7; const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 100; n++) {
    const parts = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, id) => ({ id, width: Math.round(20 + rand() * 1400), height: Math.round(20 + rand() * 1200), quantity: 1 + Math.floor(rand() * 6) }));
    const d = durma({ sheet: { width: Math.round(1000 + rand() * 2000), height: Math.round(800 + rand() * 1500), quantity: 1 + Math.floor(rand() * 3) }, parts, rotateParts: rand() > .3, trim: rand() > .7 ? 5 : 0, objective: rand() > .5 ? 'pieces' : 'material' });
    verifyShear(optimize(d), d);
  }
});
