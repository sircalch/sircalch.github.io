(() => {
  const form = document.querySelector('#agreement-form');
  const pairs = document.querySelector('#pairs');
  const tolerance = document.querySelector('#tolerance');
  const example = document.querySelector('#example');
  const canvas = document.querySelector('#agreement-plot');
  const status = document.querySelector('#agreement-status');
  const download = document.querySelector('#save-pairs');
  const format = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 4 });
  const readings = [10, 20, 30, 40, 50, 60, 70, 80];
  const exportHeader = 'metodo_a,metodo_b,media,diferencia_b_menos_a';
  const display = value => Math.abs(value) >= 1e6 || (value !== 0 && Math.abs(value) < 0.001)
    ? value.toExponential(2) : format.format(value);
  let current = null;

  function parsePairs(raw) {
    const lines = raw.replace(/^\uFEFF/, '').trim().split(/\r\n|\n|\r/);
    const exported = lines[0].trim() === exportHeader;
    const header = exported || /^metodo_a\s*[,;]\s*metodo_b$/i.test(lines[0].trim());
    const records = lines.slice(header ? 1 : 0);
    if (records.length < 3 || records.length > 1000) {
      throw new Error('Introduce entre 3 y 1,000 pares.');
    }
    return records.map((line, index) => {
      const separator = line.includes(';') ? ';' : ',';
      const cells = line.split(separator).map(cell => cell.trim());
      const normalized = cells.slice(0, 2).map(cell => separator === ';' ? cell.replace(',', '.') : cell);
      const values = normalized.map(Number);
      if (cells.length !== (exported ? 4 : 2) || normalized.some(cell => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cell)) ||
          values.some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) {
        throw new Error(`Revisa la línea ${index + 1 + Number(header)}. Se esperan dos números de hasta ±1,000 millones.`);
      }
      const [a, b] = values;
      return { a, b, mean: (a + b) / 2, difference: b - a };
    });
  }

  function summarize(rows) {
    const average = key => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
    const bias = average('difference');
    const meanA = average('a');
    const meanB = average('b');
    let varianceA = 0;
    let varianceB = 0;
    let covariance = 0;
    let squaredDifferences = 0;
    for (const { a, b, difference } of rows) {
      varianceA += (a - meanA) ** 2;
      varianceB += (b - meanB) ** 2;
      covariance += (a - meanA) * (b - meanB);
      squaredDifferences += (difference - bias) ** 2;
    }
    const denominator = Math.sqrt(varianceA) * Math.sqrt(varianceB);
    const pearson = denominator ? Math.max(-1, Math.min(1, covariance / denominator)) : null;
    const spread = 1.96 * Math.sqrt(squaredDifferences / (rows.length - 1));
    return { rows, bias, pearson, lower: bias - spread, upper: bias + spread };
  }

  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const density = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * density);
    canvas.height = Math.round(height * density);
    const ctx = canvas.getContext('2d');
    ctx.scale(density, density);
    if (!current || width < 140) return;
    const { rows, bias, lower, upper } = current;
    const means = rows.map(row => row.mean);
    const differences = rows.map(row => row.difference);
    const minX = Math.min(...means);
    const maxX = Math.max(...means);
    const minY = Math.min(0, lower, ...differences);
    const maxY = Math.max(0, upper, ...differences);
    const padX = (maxX - minX) * 0.055 || Math.max(1, Math.abs(minX) * 0.02);
    const padY = (maxY - minY) * 0.1 || 1;
    const label = value => Math.abs(value) >= 10000 || (value !== 0 && Math.abs(value) < 0.001)
      ? value.toExponential(1) : format.format(value);
    ctx.font = '12px system-ui';
    const ticksY = Array.from({ length: 5 }, (_, i) => minY - padY + (maxY - minY + 2 * padY) * i / 4);
    const left = Math.ceil(Math.max(...ticksY.map(value => ctx.measureText(label(value)).width))) + 11;
    const right = width - 22;
    const top = 10;
    const bottom = height - 27;
    const x = value => left + (value - minX + padX) / (maxX - minX + 2 * padX) * (right - left);
    const y = value => bottom - (value - minY + padY) / (maxY - minY + 2 * padY) * (bottom - top);

    function rule(value, color, dash) {
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(left, y(value));
      ctx.lineTo(right, y(value));
      ctx.stroke();
    }

    ctx.fillStyle = '#46556a';
    ctx.textAlign = 'right';
    for (const value of ticksY) {
      rule(value, '#dce3e9', []);
      ctx.fillText(label(value), left - 6, y(value) + 4);
    }
    ctx.textAlign = 'center';
    const ticksX = maxX === minX ? [minX] : [minX, (minX + maxX) / 2, maxX];
    for (const value of ticksX) ctx.fillText(label(value), x(value), bottom + 19);
    rule(0, '#768698', [2, 3]);
    if (upper !== lower) {
      rule(lower, '#99521d', [7, 4]);
      rule(upper, '#99521d', [7, 4]);
    }
    rule(bias, '#00685f', []);
    ctx.fillStyle = '#152137';
    for (const row of rows) {
      ctx.beginPath();
      ctx.arc(x(row.mean), y(row.difference), 3.8, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  function clear(message) {
    current = null;
    download.disabled = true;
    for (const selector of ['#pearson', '#bias', '#limits']) document.querySelector(selector).textContent = '—';
    document.querySelector('#tolerance-result').textContent = '';
    status.textContent = message;
    draw();
  }

  function calculate() {
    if (!form.reportValidity()) return;
    try {
      current = summarize(parsePairs(pairs.value));
    } catch (error) {
      clear(error.message);
      return;
    }
    const { rows, pearson, bias, lower, upper } = current;
    document.querySelector('#pearson').textContent = pearson === null ? 'Indefinida' : display(pearson);
    document.querySelector('#bias').textContent = display(bias);
    document.querySelector('#limits').textContent = `${display(lower)} a ${display(upper)}`;
    const limit = tolerance.valueAsNumber;
    const inside = rows.filter(row => Math.abs(row.difference) <= limit).length;
    document.querySelector('#tolerance-result').textContent = Number.isFinite(limit)
      ? `${inside} de ${rows.length} pares dentro de ±${display(limit)}.` : '';
    status.textContent = `${rows.length} pares calculados.`;
    download.disabled = false;
    draw();
  }

  function loadExample() {
    const variations = [-1, 1, -2, 0, 0, 2, 1, -1];
    pairs.value = readings.map((a, index) => {
      const offset = { offset: 5, proportional: a / 10, variation: variations[index] }[example.value];
      return `${a},${a + offset}`;
    }).join('\n');
    clear('');
    calculate();
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    calculate();
  });
  form.addEventListener('input', () => clear('Vuelve a calcular después de cambiar los datos.'));
  example.addEventListener('change', loadExample);
  download.addEventListener('click', () => {
    if (!current) return;
    const rows = current.rows.map(({ a, b, mean, difference }) => [a, b, mean, difference].join(','));
    const url = URL.createObjectURL(new Blob([[exportHeader, ...rows].join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'concordancia-mediciones.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  new ResizeObserver(draw).observe(canvas);
  loadExample();
})();
