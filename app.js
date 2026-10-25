(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const palette = ['#3d8862', '#b87824', '#587fbd', '#a05a92', '#308b88', '#bd6050', '#8666b2', '#788631'];
  const fmt = n => Number(n.toFixed(6)).toLocaleString('en-US', { maximumFractionDigits: 6, useGrouping: false });
  const area = n => `${(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 4 })} m²`;
  const partList = $('#part-list');
  let lastPlan = null, sheetIndex = 0, selectedCut = -1, revision = 0, busy = false, stale = false;
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
  };
  function node(tag, text, className) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  }
  function showError(message) {
    $('#error').textContent = message;
    $('#error').style.display = 'block';
    $('#error').focus();
  }
  function hideError() { $('#error').style.display = 'none'; }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const dark = theme === 'dark';
    $('#theme-toggle').textContent = dark ? '☀ Day colors' : '☾ Night colors';
    $('#theme-toggle').setAttribute('aria-label', dark ? 'Switch to day colors' : 'Switch to night colors');
    $('#theme-toggle').setAttribute('aria-pressed', dark);
    $('meta[name="theme-color"]').content = dark ? '#151c18' : '#f4f5f2';
    store.set('cutwise-theme', theme);
    if (lastPlan) drawLayout();
  }
  function updateRows() {
    const capacity = $('[name="mode"]:checked').value === 'capacity';
    $$('.part-row').forEach((row, i) => {
      const id = `P${i + 1}`;
      $('.part-id', row).textContent = id;
      $('.part-id', row).style.color = palette[i % palette.length];
      for (const [selector, label] of [['.part-width', 'width'], ['.part-height', 'height'], ['.qty-input', 'quantity'], ['.remove-btn', 'remove size']]) {
        $(selector, row).setAttribute('aria-label', `${id} ${label}`);
      }
      $('.qty-input', row).disabled = capacity;
      $('.qty-input', row).title = capacity ? 'Quantity is calculated in capacity mode' : '';
    });
    $('#add-part').disabled = partList.children.length >= 50;
    $('#sheet-quantity').disabled = capacity;
    $('#mode-hint').textContent = capacity ? 'Use one piece size. Find the best quantity on one sheet; the quantity field is ignored.' : 'Enter the sizes and quantities you need.';
  }
  function addPart(width = '', height = '', quantity = 1, focus = false) {
    if (partList.children.length >= 50) return;
    const row = node('div', undefined, 'part-row');
    row.innerHTML = '<span class="part-id"></span><input type="number" min="0.001" step="any" class="part-width" placeholder="Width"><input type="number" min="0.001" step="any" class="part-height" placeholder="Height"><input type="number" min="1" max="2000" step="1" class="qty-input"><button class="remove-btn" type="button">×</button>';
    $('.part-width', row).value = width;
    $('.part-height', row).value = height;
    $('.qty-input', row).value = quantity;
    $('.remove-btn', row).addEventListener('click', () => {
      if (partList.children.length > 1) row.remove();
      else { $('.part-width', row).value = ''; $('.part-height', row).value = ''; $('.qty-input', row).value = 1; }
      updateRows(); changed();
    });
    partList.append(row);
    updateRows();
    if (focus) $('.part-width', row).focus();
  }
  function snapshot() {
    return {
      version: 1, name: $('#job-name').value,
      width: $('#stock-width').value, height: $('#stock-height').value,
      widthUnit: $('[aria-label="Sheet width units"]').value, heightUnit: $('[aria-label="Sheet height units"]').value,
      partUnit: $('#part-unit').value, sheets: $('#sheet-quantity').value,
      kerf: $('#kerf').value, trim: $('#trim').value, rotate: $('#allow-rotation').checked,
      mode: $('[name="mode"]:checked').value,
      parts: $$('.part-row').map(row => ({ width: $('.part-width', row).value, height: $('.part-height', row).value, quantity: $('.qty-input', row).value }))
    };
  }
  function checkJob(job) {
    if (!job || job.version !== 1 || !Array.isArray(job.parts) || job.parts.length < 1 || job.parts.length > 50) throw new Error('Choose a Cutwise job file saved by this version of the app.');
    if (!['mm', 'm'].includes(job.widthUnit) || !['mm', 'm'].includes(job.heightUnit) || !['mm', 'm'].includes(job.partUnit) || !['order', 'capacity'].includes(job.mode) || typeof job.rotate !== 'boolean') throw new Error('The job file contains invalid settings.');
    for (const value of [job.width, job.height, job.sheets, job.kerf, job.trim, ...job.parts.flatMap(p => p ? [p.width, p.height, p.quantity] : [null])]) {
      if (!['string', 'number'].includes(typeof value) || String(value).length > 30 || (value !== '' && !Number.isFinite(Number(value)))) throw new Error('The job file contains invalid dimensions or quantities.');
    }
    if (job.name !== undefined && typeof job.name !== 'string') throw new Error('The job reference must be text.');
    return job;
  }
  function restore(job) {
    checkJob(job);
    $('#job-name').value = (job.name || '').slice(0, 80);
    for (const [key, selector] of [['width', '#stock-width'], ['height', '#stock-height'], ['sheets', '#sheet-quantity'], ['kerf', '#kerf'], ['trim', '#trim']]) $(selector).value = job[key];
    $('[aria-label="Sheet width units"]').value = job.widthUnit;
    $('[aria-label="Sheet height units"]').value = job.heightUnit;
    $('#part-unit').value = job.partUnit;
    $('#allow-rotation').checked = job.rotate;
    $(`[name="mode"][value="${job.mode}"]`).checked = true;
    partList.replaceChildren();
    job.parts.forEach(p => addPart(p.width, p.height, p.quantity));
    $$('.unit-select, #part-unit').forEach(s => s.dataset.previous = s.value);
    updateRows();
  }
  function changed() {
    revision++;
    const saved = store.set('cutwise-job-v1', JSON.stringify(snapshot()));
    $('#save-state').textContent = saved ? 'Saved on this device' : 'Auto-save unavailable · use Save job';
    if (lastPlan) {
      stale = true;
      $('#status').textContent = 'Inputs changed · recalculate';
      $('#status').classList.add('stale');
      $('#plan-message').hidden = false;
      $('#plan-message').className = 'plan-message warning';
      $('#plan-message').textContent = 'This plan uses your previous inputs. Calculate again to update the layout and exports.';
    }
    $$('#export-svg, #export-csv, #print-plan').forEach(b => b.disabled = !!lastPlan && stale);
  }
  function mm(value, unit) { return Number(value) * (unit === 'm' ? 1000 : 1); }
  function collect() {
    const job = snapshot();
    // A partial or blank row is an error, rather than silently losing a requested size.
    const data = {
      sheet: { width: mm(job.width, job.widthUnit), height: mm(job.height, job.heightUnit), quantity: job.mode === 'capacity' ? 1 : Number(job.sheets) },
      parts: job.parts.map((p, i) => ({ id: i, width: mm(p.width, job.partUnit), height: mm(p.height, job.partUnit), quantity: job.mode === 'capacity' ? 1 : Number(p.quantity) })),
      kerf: job.kerf === '' ? NaN : Number(job.kerf), trim: job.trim === '' ? NaN : Number(job.trim),
      rotateParts: job.rotate, mode: job.mode, name: job.name
    };
    return Cutwise.validate(data);
  }
  function calculate(data) {
    // A worker keeps larger jobs from blocking the controls. Direct-file usage has a fallback.
    return new Promise((resolve, reject) => {
      let worker;
      const fallback = () => { if (worker) worker.terminate(); setTimeout(() => { try { resolve(Cutwise.optimize(data)); } catch (e) { reject(e); } }, 0); };
      try {
        worker = new Worker('planner-worker.js');
        worker.onmessage = ({ data: response }) => { worker.terminate(); response.error ? reject(new Error(response.error)) : resolve(response.result); };
        worker.onerror = e => { e.preventDefault(); fallback(); };
        worker.postMessage(data);
      } catch { fallback(); }
    });
  }
  function svgElement(tag, attrs = {}, text) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, value]) => e.setAttribute(key, value));
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function buildSvg(sheet, data, dark = false, cutIndex = -1) {
    const { width, height } = data.sheet;
    const max = Math.max(width, height), pad = max * .1, font = max * .021;
    const svg = svgElement('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `${-pad} ${-pad} ${width + 2 * pad} ${height + 2 * pad}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': `Cutting layout: ${fmt(width)} by ${fmt(height)} millimeters, ${sheet.placements.length} pieces. Origin at top left.` });
    svg.append(svgElement('title', {}, `${data.name || 'Cutwise'} · ${fmt(width)} × ${fmt(height)} mm`));
    svg.append(svgElement('desc', {}, 'P IDs identify piece sizes. All positions and finished dimensions are in millimeters from the top-left sheet corner. This is a cutting diagram, not a CNC toolpath.'));
    const ink = dark ? '#e5eee8' : '#25372f';
    svg.append(svgElement('rect', { x: 0, y: 0, width, height, fill: dark ? '#3c4038' : '#e4e6e0', stroke: dark ? '#a4b2ab' : '#73817b', 'stroke-width': max * .0015 }));
    if (data.trim) svg.append(svgElement('rect', { x: data.trim, y: data.trim, width: width - 2 * data.trim, height: height - 2 * data.trim, fill: dark ? '#26332b' : '#f4f6f1', stroke: '#89988c', 'stroke-dasharray': `${max * .006} ${max * .004}`, 'stroke-width': max * .001 }));
    for (const r of sheet.remnants) {
      const offcut = svgElement('rect', { ...r, fill: dark ? '#2c3930' : '#f1f3ed' });
      offcut.append(svgElement('title', {}, `Offcut ${fmt(r.width)} × ${fmt(r.height)} mm · X ${fmt(r.x)}, Y ${fmt(r.y)}`));
      svg.append(offcut);
      const size = Math.min(font * .7, r.width / 12, r.height / 3);
      if (size >= max * .009) svg.append(svgElement('text', { x: r.x + r.width / 2, y: r.y + r.height / 2, fill: dark ? '#aab8b0' : '#667669', 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': size, 'font-family': 'system-ui, sans-serif' }, `${fmt(r.width)} × ${fmt(r.height)} offcut`));
    }
    for (const cut of sheet.cuts) {
      svg.append(svgElement('rect', { x: cut.x, y: cut.y, width: cut.axis === 'x' ? cut.kerf : cut.length, height: cut.axis === 'y' ? cut.kerf : cut.length, fill: '#e7b557', 'fill-opacity': .75 }));
    }
    sheet.placements.forEach((p, i) => {
      const color = palette[p.partId % palette.length];
      const group = svgElement('g');
      const rect = svgElement('rect', { x: p.x, y: p.y, width: p.width, height: p.height, fill: color, 'fill-opacity': dark ? .45 : .24, stroke: color, 'stroke-width': max * .0012 });
      rect.append(svgElement('title', {}, `P${p.partId + 1} · piece ${i + 1} · ${fmt(p.width)} × ${fmt(p.height)} mm · X ${fmt(p.x)}, Y ${fmt(p.y)}${p.rotated ? ' · rotated 90°' : ''}`));
      group.append(rect);
      const size = Math.min(font, p.width / 4.5, p.height / 3);
      if (size >= max * .008) {
        const x = p.x + p.width / 2, y = p.y + p.height / 2;
        group.append(svgElement('text', { x, y: y - size * .25, 'text-anchor': 'middle', fill: ink, 'font-size': size, 'font-weight': 750, 'font-family': 'system-ui, sans-serif' }, `P${p.partId + 1}${p.rotated ? ' ↻' : ''}`));
        const dimensions = `${fmt(p.width)} × ${fmt(p.height)}`;
        if (dimensions.length * size * .36 < p.width * .92) group.append(svgElement('text', { x, y: y + size * .95, 'text-anchor': 'middle', fill: ink, 'font-size': size * .65, 'font-family': 'system-ui, sans-serif' }, dimensions));
      }
      svg.append(group);
    });
    if (cutIndex >= 0 && sheet.cuts[cutIndex]) {
      const c = sheet.cuts[cutIndex];
      svg.append(svgElement('rect', { ...c.rect, fill: 'none', stroke: dark ? '#fff' : '#25372f', 'stroke-width': max * .003, 'stroke-dasharray': `${max * .008} ${max * .004}` }));
      svg.append(svgElement('line', { x1: c.x, y1: c.y, x2: c.x + (c.axis === 'y' ? c.length : 0), y2: c.y + (c.axis === 'x' ? c.length : 0), stroke: '#e9553f', 'stroke-width': max * .005 }));
    }
    const label = (x, y, value, attrs = {}) => svg.append(svgElement('text', { x, y, fill: ink, 'font-size': font, 'font-weight': 600, 'text-anchor': 'middle', 'font-family': 'system-ui, sans-serif', ...attrs }, value));
    label(width / 2, -pad * .4, `${fmt(width)} mm`);
    label(-pad * .42, height / 2, `${fmt(height)} mm`, { transform: `rotate(-90 ${-pad * .42} ${height / 2})` });
    label(0, height + pad * .55, '0,0 = top-left · mm', { 'text-anchor': 'start', 'font-size': font * .7 });
    return svg;
  }
  function drawLayout() {
    if (!lastPlan || !lastPlan.result.sheets.length) return;
    const { data, result } = lastPlan;
    const svg = buildSvg(result.sheets[sheetIndex], data, document.documentElement.dataset.theme === 'dark', selectedCut);
    svg.id = 'layout';
    $('#layout').replaceWith(svg);
    $('#empty-state').hidden = true;
  }
  function cutText(c, index) {
    return `Cut ${index + 1}: ${c.axis === 'x' ? 'Vertical' : 'Horizontal'} · ${fmt(c.offset)} mm from the ${c.axis === 'x' ? 'left' : 'top'} edge of this rectangle`;
  }
  function cutDetail(c) {
    return `Rectangle ${fmt(c.rect.width)} × ${fmt(c.rect.height)} mm at X ${fmt(c.rect.x)}, Y ${fmt(c.rect.y)} · cut length ${fmt(c.length)} mm`;
  }
  function preparation(data) {
    return data.trim ? `First prepare a ${fmt(data.sheet.width - 2 * data.trim)} × ${fmt(data.sheet.height - 2 * data.trim)} mm usable rectangle, reserving ${fmt(data.trim)} mm on every side (including trim-cut blade loss). Then follow these cuts.` : 'Start from the full sheet. Follow these cuts in order.';
  }
  function renderSheet() {
    const { result, data } = lastPlan, sheet = result.sheets[sheetIndex];
    if (!sheet) return;
    $('#sheet-picker').value = sheetIndex;
    $('#prev-sheet').disabled = sheetIndex === 0;
    $('#next-sheet').disabled = sheetIndex === result.sheets.length - 1;
    $('#sheet-label').textContent = `${fmt(data.sheet.width)} × ${fmt(data.sheet.height)} mm · ${sheet.placements.length} pieces · ${fmt(data.kerf)} mm kerf`;
    const remainingArea = sheet.remnants.reduce((s, r) => s + r.width * r.height, 0);
    const trimArea = data.sheet.width * data.sheet.height - (data.sheet.width - 2 * data.trim) * (data.sheet.height - 2 * data.trim);
    $('#material-details').replaceChildren(...[
      `This sheet: ${(100 * sheet.usedArea / (data.sheet.width * data.sheet.height)).toFixed(1)}% used`,
      `Offcuts: ${area(remainingArea)}`, `Blade loss: ${area(sheet.kerfArea)}`, ...(data.trim ? [`Reserved edge: ${area(trimArea)}`] : [])
    ].map(t => node('span', t)));
    $('#cut-count').textContent = `(${sheet.cuts.length})`;
    $('#cut-help').textContent = `${preparation(data)} Select a step to highlight it. Offsets mark the finished edge; place the blade on the offcut side. All X / Y positions start at the full sheet’s top-left corner.`;
    const list = $('#cut-steps'); list.replaceChildren();
    sheet.cuts.forEach((c, i) => {
      const li = node('li'), button = node('button', undefined, 'cut-step'); button.type = 'button';
      button.setAttribute('aria-pressed', String(i === selectedCut));
      const text = node('span', cutText(c, i).replace(`Cut ${i + 1}: `, ''));
      text.append(node('span', cutDetail(c), 'step-detail'));
      button.append(node('span', String(i + 1), 'step-number'), text);
      button.addEventListener('click', () => {
        selectedCut = selectedCut === i ? -1 : i;
        $$('.cut-step').forEach((b, j) => b.setAttribute('aria-pressed', String(j === selectedCut)));
        drawLayout();
      });
      li.append(button); list.append(li);
    });
    if (!sheet.cuts.length) list.append(node('li', 'The piece already matches the usable sheet. No separation cuts needed.', 'hint'));
    const grouped = new Map();
    sheet.remnants.slice().sort((a, b) => b.width * b.height - a.width * a.height).forEach(r => {
      const key = `${fmt(r.width)} × ${fmt(r.height)} mm`;
      grouped.set(key, (grouped.get(key) || 0) + 1);
    });
    $('#offcut-list').replaceChildren(...(grouped.size ? [...grouped].map(([size, quantity]) => node('div', `${quantity} × ${size}`)) : [node('p', 'No reusable offcuts remain.')]));
    drawLayout();
  }
  function renderSummary(result, data) {
    lastPlan = { result, data }; sheetIndex = 0; selectedCut = -1; stale = false;
    $('#status').classList.remove('stale');
    $('#fit-stat').textContent = data.mode === 'capacity' ? `${result.count}` : `${result.count} / ${result.total}`;
    $('#yield-stat').textContent = `${(result.sheets.length ? 100 * result.area / (result.sheets.length * data.sheet.width * data.sheet.height) : 0).toFixed(1)}%`;
    $('#left-stat').textContent = data.mode === 'capacity' ? '—' : result.total - result.count;
    $('#sheets-stat').textContent = `${result.sheets.length} / ${data.sheet.quantity}`;
    const complete = data.mode === 'order' && result.count === result.total;
    $('#status').textContent = result.count === 0 ? 'No pieces fit' : complete ? 'Order fits' : 'Best plan found';
    const messages = [];
    if (data.mode === 'capacity') messages.push(`${result.count} pieces fit on one sheet in the best plan found. Quantity includes any allowed 90° rotations.`);
    else if (complete) messages.push(`All ${result.total} pieces fit on ${result.sheets.length} ${result.sheets.length === 1 ? 'sheet' : 'sheets'}. ${data.sheet.quantity - result.sheets.length ? `${data.sheet.quantity - result.sheets.length} available sheets remain unused.` : ''}`);
    else messages.push(`${result.total - result.count} pieces remain unplanned. ${result.impossible.length ? 'Some sizes exceed the usable sheet.' : 'Add available sheets or adjust your piece sizes, blade width or rotation setting.'}`);
    if (result.impossible.length) messages.push(`${result.impossible.map(id => `P${id + 1}`).join(', ')} cannot fit on an empty sheet with these trim and rotation settings.`);
    $('#plan-message').textContent = messages.join(' ');
    $('#plan-message').className = `plan-message${result.impossible.length || (!complete && data.mode === 'order') ? ' warning' : ''}`;
    $('#plan-message').hidden = false;
    const hasSheets = result.sheets.length > 0;
    for (const id of ['#plan-tools', '#material-details', '#cut-instructions']) $(id).hidden = !hasSheets;
    $$('#export-svg, #export-csv, #print-plan').forEach(b => b.disabled = false);
    $('#sheet-picker').replaceChildren(...result.sheets.map((_, i) => { const o = node('option', `Sheet ${i + 1} of ${result.sheets.length}`); o.value = i; return o; }));
    const table = node('table', undefined, 'cut-table');
    table.append(node('caption', 'Whole order · finished sizes in mm. P IDs match the layout.'));
    table.innerHTML += '<thead><tr><th scope="col">Piece / size</th><th scope="col" class="number">Needed</th><th scope="col" class="number">Planned</th><th scope="col" class="number">Left</th></tr></thead>';
    const body = node('tbody');
    const counts = new Map();
    result.sheets.forEach(s => s.placements.forEach(p => counts.set(p.partId, (counts.get(p.partId) || 0) + 1)));
    data.parts.forEach(p => {
      const count = counts.get(p.id) || 0, row = node('tr'), cell = node('th'); cell.scope = 'row';
      const swatch = node('i', undefined, 'part-swatch'); swatch.style.backgroundColor = palette[p.id % palette.length];
      cell.style.fontWeight = '500'; cell.style.textTransform = 'none'; cell.style.letterSpacing = '0'; cell.style.fontSize = '11px';
      cell.append(swatch, document.createTextNode(`P${p.id + 1} · ${fmt(p.width)} × ${fmt(p.height)}`)); row.append(cell);
      [data.mode === 'capacity' ? '—' : p.quantity, count, data.mode === 'capacity' ? '—' : p.quantity - count].forEach((v, i) => row.append(node('td', String(v), `number${i === 2 && v > 0 ? ' shortage' : ''}`)));
      body.append(row);
    });
    table.append(body); $('#cut-summary').replaceChildren(table);
    if (hasSheets) renderSheet();
    else {
      $('#layout').hidden = true; $('#empty-state').hidden = false;
      $('#empty-state').textContent = 'No requested pieces fit. Check the highlighted message and adjust your dimensions.';
      $('#sheet-label').textContent = 'Dimensions shown in mm';
    }
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = node('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const filename = () => ($('#job-name').value.trim() || 'cutwise-job').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80);
  $('#planner-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    let data; try { data = collect(); } catch (error) { showError(error.message); return; }
    hideError(); busy = true; const started = revision;
    $('#optimize').disabled = true; $('#optimize').textContent = 'Calculating…';
    try {
      const result = await calculate(data);
      if (revision === started) renderSummary(result, data);
      else showError('Inputs changed during calculation. Calculate again to use your latest values.');
    } catch (error) { showError(error.message); }
    finally { busy = false; $('#optimize').disabled = false; $('#optimize').textContent = 'Calculate cutting plan'; }
  });
  $('#add-part').addEventListener('click', () => { addPart('', '', 1, true); changed(); });
  $('#planner-form').addEventListener('input', e => { if (e.target.matches('[name="mode"]')) updateRows(); changed(); });
  $('#job-name').addEventListener('input', changed);
  $$('.unit-select, #part-unit').forEach(select => {
    select.dataset.previous = select.value;
    select.addEventListener('change', () => {
      const previous = select.dataset.previous, next = select.value;
      const inputs = select.id === 'part-unit' ? $$('.part-width, .part-height') : [$('input', select.parentElement)];
      inputs.forEach(input => { if (input.value !== '') input.value = fmt(Number(input.value) * (previous === 'm' ? 1000 : 1) / (next === 'm' ? 1000 : 1)); });
      select.dataset.previous = next; changed();
    });
  });
  $('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#sheet-picker').addEventListener('change', () => { sheetIndex = Number($('#sheet-picker').value); selectedCut = -1; renderSheet(); });
  $('#prev-sheet').addEventListener('click', () => { sheetIndex--; selectedCut = -1; renderSheet(); });
  $('#next-sheet').addEventListener('click', () => { sheetIndex++; selectedCut = -1; renderSheet(); });
  $('#show-all-cuts').addEventListener('click', () => { selectedCut = -1; $$('.cut-step').forEach(b => b.setAttribute('aria-pressed', 'false')); drawLayout(); });
  $('#save-job').addEventListener('click', () => { download(`${filename()}.json`, JSON.stringify(snapshot(), null, 2), 'application/json'); });
  $('#open-job').addEventListener('click', () => $('#job-file').click());
  $('#job-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 100000) throw new Error('Choose a Cutwise job file smaller than 100 KB.');
      const job = checkJob(JSON.parse(await file.text()));
      restore(job); changed(); hideError();
      $('#save-state').textContent = 'Job opened · calculate to see its plan';
    } catch (error) { showError(error instanceof SyntaxError ? 'This file is not a valid Cutwise JSON job.' : error.message); }
    event.target.value = '';
  });
  $('#export-svg').addEventListener('click', () => {
    if (!lastPlan || stale) return;
    const svg = buildSvg(lastPlan.result.sheets[sheetIndex], lastPlan.data);
    const viewBox = svg.getAttribute('viewBox').split(' ').map(Number);
    svg.setAttribute('width', `${fmt(viewBox[2])}mm`); svg.setAttribute('height', `${fmt(viewBox[3])}mm`);
    download(`${filename()}-sheet-${sheetIndex + 1}.svg`, new XMLSerializer().serializeToString(svg), 'image/svg+xml');
  });
  $('#export-csv').addEventListener('click', () => {
    if (!lastPlan || stale) return;
    const rows = [['Type', 'Sheet', 'ID / step', 'Width mm', 'Height mm', 'X mm', 'Y mm', 'Rotated', 'Direction', 'Offset mm', 'Cut length mm', 'Kerf mm']];
    lastPlan.result.sheets.forEach((s, i) => {
      s.placements.forEach(p => rows.push(['Piece', i + 1, `P${p.partId + 1}`, fmt(p.width), fmt(p.height), fmt(p.x), fmt(p.y), p.rotated ? 'Yes' : 'No', '', '', '', '']));
      s.cuts.forEach((c, j) => rows.push(['Cut', i + 1, j + 1, fmt(c.rect.width), fmt(c.rect.height), fmt(c.rect.x), fmt(c.rect.y), '', c.axis === 'x' ? 'Vertical' : 'Horizontal', fmt(c.offset), fmt(c.length), fmt(c.kerf)]));
      s.remnants.forEach((r, j) => rows.push(['Offcut', i + 1, j + 1, fmt(r.width), fmt(r.height), fmt(r.x), fmt(r.y), '', '', '', '', '']));
    });
    download(`${filename()}-cut-list.csv`, rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  });
  function preparePrint() {
    const container = $('#print-sheets'); container.replaceChildren();
    document.body.dataset.printReady = String(!!lastPlan && !stale);
    $('#print-warning').textContent = stale ? 'Inputs have changed. Recalculate before printing a cutting plan.' : !lastPlan ? 'Calculate a cutting plan before printing.' : '';
    if (!lastPlan || stale) return;
    $('#print-job-title').textContent = lastPlan.data.name || 'Cutwise cutting plan';
    lastPlan.result.sheets.forEach((s, i) => {
      const section = node('section', undefined, 'print-sheet');
      section.append(node('h3', `${lastPlan.data.name || 'Cutwise'} · Sheet ${i + 1} of ${lastPlan.result.sheets.length}`));
      section.append(buildSvg(s, lastPlan.data));
      section.append(node('p', `${preparation(lastPlan.data)} Blade width ${fmt(lastPlan.data.kerf)} mm. Offsets are finished edges; blade goes on the offcut side. Coordinates are from the full sheet’s top left.`, 'footnote'));
      const list = node('ol');
      s.cuts.forEach((c, j) => list.append(node('li', `${cutText(c, j)}. ${cutDetail(c)}.`)));
      section.append(list); container.append(section);
    });
  }
  window.addEventListener('beforeprint', preparePrint);
  $('#print-plan').addEventListener('click', () => { if (lastPlan && !stale) { preparePrint(); window.print(); } });
  setTheme(store.get('cutwise-theme') === 'dark' ? 'dark' : 'light');
  const saved = store.get('cutwise-job-v1');
  if (saved) { try { restore(JSON.parse(saved)); $('#save-state').textContent = 'Previous job restored'; } catch { addPart(1000, 500, 2); addPart(600, 400, 3); } }
  else { addPart(1000, 500, 2); addPart(600, 400, 3); }
  $$('.unit-select, #part-unit').forEach(s => s.dataset.previous = s.value);
})();
