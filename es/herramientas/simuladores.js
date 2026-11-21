const simulation = document.querySelector('[data-simulation]');
const chart = document.querySelector('canvas');
const stats = document.querySelectorAll('[data-stat]');
const numberFormat = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 });
const seriesColors = ['#00685f', '#99521d'];

function randomStream(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function correlation(points) {
  const mx = mean(points.map(point => point.x));
  const my = mean(points.map(point => point.y));
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const point of points) {
    const dx = point.x - mx;
    const dy = point.y - my;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  return xx && yy ? xy / Math.sqrt(xx * yy) : null;
}

function numbers() {
  return Array.from(simulation.querySelectorAll('input'), input => input.valueAsNumber);
}

function measurement() {
  const [bias, noise, count] = numbers();
  const reference = 10;
  const uniform = randomStream(173);
  const points = Array.from({ length: count }, (_, index) => {
    const z = Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
    return { x: index + 1, y: reference + bias + noise * z, group: 0 };
  });
  const average = mean(points.map(point => point.y));
  const variance = points.reduce((sum, point) => sum + (point.y - average) ** 2, 0) / (count - 1);
  return {
    points, reference, values: [average, average - reference, Math.sqrt(variance)],
    xLabel: 'Índice de medición', yLabel: 'Medición', xMin: 1, xMax: count,
    csv: ['indice,medicion,referencia,sesgo_configurado,ruido_configurado',
      ...points.map(point => [point.x, point.y, reference, bias, noise].join(','))],
  };
}

function groups() {
  const [separation, scatter] = numbers();
  const uniform = randomStream(267);
  const points = [0, 1].flatMap(group => Array.from({ length: 12 }, (_, index) => {
    const position = (index - 5.5) / 3;
    const shift = (group - .5) * separation;
    return { x: 5 + shift + position, y: 5 - shift + position * .8 + (uniform() * 2 - 1) * scatter, group };
  }));
  return {
    points, values: [correlation(points.filter(point => point.group === 0)),
      correlation(points.filter(point => point.group === 1)), correlation(points)],
    xLabel: 'Variable X', yLabel: 'Variable Y', xMin: -1, xMax: 11,
    csv: ['grupo,x,y,separacion,dispersion',
      ...points.map(point => [point.group ? 'B' : 'A', point.x, point.y, separation, scatter].join(','))],
  };
}

function signalFilter() {
  const [size] = numbers();
  const samplingRate = 100;
  const lowHz = 2;
  const highHz = 20;
  const duration = 2;
  const rows = Array.from({ length: duration * samplingRate }, (_, index) => {
    const time = index / samplingRate;
    const tone = Math.sin(2 * Math.PI * lowHz * time);
    const interference = .45 * Math.sin(2 * Math.PI * highHz * time);
    return { time, tone, interference, input: tone + interference };
  });
  const filtered = rows.map((row, index) => {
    const window = rows.slice(Math.max(0, index + 1 - size), index + 1);
    return { ...row, used: window.length, output: mean(window.map(sample => sample.input)) };
  });
  const gain = frequency => {
    const angle = Math.PI * frequency / samplingRate;
    return 100 * Math.abs(Math.sin(size * angle) / (size * Math.sin(angle)));
  };
  return {
    points: filtered.map(row => ({ x: row.time, y: row.output })),
    input: filtered.map(row => ({ x: row.time, y: row.input })),
    values: [gain(lowHz), gain(highHz), (size - 1) * 500 / samplingRate],
    units: ['%', '%', 'ms'],
    xLabel: 'Tiempo (s)', yLabel: 'Amplitud', xMin: 0, xMax: duration,
    csv: ['muestra,tiempo_s,tono_2_hz,interferencia_20_hz,entrada,salida,ventana,muestras_usadas',
      ...filtered.map((row, index) => [index + 1, row.time, row.tone, row.interference,
        row.input, row.output, size, row.used].join(','))],
  };
}

function aliasing() {
  const [frequency, rate] = numbers();
  const duration = 100;
  const equivalent = Math.abs(frequency - rate * Math.round(frequency / rate));
  const amplitude = (hz, milliseconds) => Math.cos(2 * Math.PI * hz * milliseconds / 1000);
  const time = Array.from({ length: 401 }, (_, i) => i * duration / 400);
  const samples = Array.from({ length: Math.floor(rate / 10) + 1 }, (_, index) => {
    const milliseconds = 1000 * index / rate;
    return {
      x: milliseconds,
      y: amplitude(frequency, milliseconds),
      apparent: amplitude(equivalent, milliseconds),
    };
  });
  const mode = 2 * frequency === rate
    ? 'Caso de Nyquist. La práctica usa fase cero.'
    : frequency > rate / 2 ? 'Hay aliasing en este ejemplo.' : 'La frecuencia de entrada queda por debajo de Nyquist.';
  return {
    input: time.map(x => ({ x, y: amplitude(frequency, x) })),
    points: time.map(x => ({ x, y: amplitude(equivalent, x) })),
    markers: samples,
    values: [equivalent, rate / 2, Math.max(...samples.map(row => Math.abs(row.y - row.apparent)))],
    units: ['Hz', 'Hz', ''],
    status: `${samples.length} muestras. ${mode}`,
    xLabel: 'Tiempo (ms)', yLabel: 'Amplitud', xMin: 0, xMax: duration,
    csv: ['muestra,tiempo_ms,entrada,coseno_equivalente,frecuencia_entrada_hz,muestreo_hz,frecuencia_equivalente_hz',
      ...samples.map((row, index) => [index + 1, row.x, row.y, row.apparent, frequency, rate, equivalent].join(','))],
  };
}

function paint({ points, input, markers, reference, xLabel, yLabel, xMin, xMax }) {
  const width = chart.clientWidth;
  const height = chart.clientHeight;
  if (!width || !height) return;
  const scale = window.devicePixelRatio || 1;
  chart.width = Math.round(width * scale);
  chart.height = Math.round(height * scale);
  const context = chart.getContext('2d');
  context.scale(scale, scale);
  const bounds = { left: 47, right: width - 15, top: 12, bottom: height - 42 };
  const ys = points.map(point => point.y);
  if (input) ys.push(...input.map(point => point.y));
  if (reference !== undefined) ys.push(reference);
  const minimum = Math.min(...ys);
  const maximum = Math.max(...ys);
  const margin = Math.max(.5, (maximum - minimum) * .09);
  const yMin = minimum - margin;
  const yMax = maximum + margin;
  const x = value => bounds.left + (value - xMin) * (bounds.right - bounds.left) / (xMax - xMin);
  const y = value => bounds.bottom - (value - yMin) * (bounds.bottom - bounds.top) / (yMax - yMin);

  context.font = '12px system-ui';
  context.strokeStyle = '#dbe1e7';
  context.fillStyle = '#46556a';
  context.textAlign = 'right';
  for (let tick = 0; tick <= 4; tick++) {
    const value = yMin + (yMax - yMin) * tick / 4;
    const line = y(value);
    context.beginPath();
    context.moveTo(bounds.left, line);
    context.lineTo(bounds.right, line);
    context.stroke();
    const rounded = Math.round(value * 10) / 10;
    context.fillText(numberFormat.format(rounded === 0 ? 0 : rounded), bounds.left - 6, line + 4);
  }
  context.strokeStyle = '#8494a3';
  context.beginPath();
  context.moveTo(bounds.left, bounds.top);
  context.lineTo(bounds.left, bounds.bottom);
  context.lineTo(bounds.right, bounds.bottom);
  context.stroke();
  if (reference !== undefined) {
    context.strokeStyle = '#152137';
    context.setLineDash([5, 4]);
    context.beginPath();
    context.moveTo(bounds.left, y(reference));
    context.lineTo(bounds.right, y(reference));
    context.stroke();
    context.setLineDash([]);
  }
  context.textAlign = 'center';
  for (let tick = 0; tick <= 4; tick++) {
    const position = xMin + (xMax - xMin) * tick / 4;
    const value = input ? position : Math.round(position);
    context.fillText(numberFormat.format(value), x(value), bounds.bottom + 15);
  }
  context.fillText(xLabel, (bounds.left + bounds.right) / 2, height - 8);
  context.save();
  context.translate(11, (bounds.top + bounds.bottom) / 2);
  context.rotate(-Math.PI / 2);
  context.fillText(yLabel, 0, 0);
  context.restore();
  if (input) {
    for (const [series, color, dash] of [[input, seriesColors[1], [4, 3]], [points, seriesColors[0], []]]) {
      context.strokeStyle = color;
      context.lineWidth = 1.7;
      context.setLineDash(dash);
      context.beginPath();
      context.moveTo(x(series[0].x), y(series[0].y));
      for (const point of series.slice(1)) context.lineTo(x(point.x), y(point.y));
      context.stroke();
    }
    if (markers) {
      context.setLineDash([]);
      context.fillStyle = '#152137';
      context.strokeStyle = '#fff';
      context.lineWidth = 1;
      for (const point of markers) {
        context.beginPath();
        context.arc(x(point.x), y(point.y), 3.7, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
    }
    return;
  }
  for (const point of points) {
    context.fillStyle = seriesColors[point.group];
    if (point.group) {
      context.fillRect(x(point.x) - 3.5, y(point.y) - 3.5, 7, 7);
    } else {
      context.beginPath();
      context.arc(x(point.x), y(point.y), 3.5, 0, Math.PI * 2);
      context.fill();
    }
  }
}

const simulations = {
  measurement: { calculate: measurement, filename: 'mediciones-simuladas.csv' },
  groups: { calculate: groups, filename: 'correlacion-simuladas.csv' },
  signal: { calculate: signalFilter, filename: 'signalforge-filtrado.csv' },
  aliasing: { calculate: aliasing, filename: 'muestreo-aliasing.csv' },
};
const selected = simulations[simulation.dataset.simulation];

let current;
function update() {
  if (!simulation.checkValidity()) {
    document.querySelector('#status').textContent = current
      ? 'Revisa los parámetros. Se conserva la última gráfica válida.'
      : 'Revisa los rangos de los parámetros.';
    simulation.querySelector('button').disabled = true;
    return;
  }
  current = selected.calculate();
  current.values.forEach((value, index) => {
    const unit = current.units?.[index];
    stats[index].textContent = value === null ? 'Sin definir' : numberFormat.format(value) + (unit ? ` ${unit}` : '');
  });
  document.querySelector('#status').textContent = current.status ?? `${current.points.length} observaciones simuladas.`;
  simulation.querySelector('button').disabled = false;
  paint(current);
}

simulation.addEventListener('input', update);
simulation.addEventListener('submit', event => {
  event.preventDefault();
  const url = URL.createObjectURL(new Blob([current.csv.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = selected.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
});
new ResizeObserver(() => { if (current) paint(current); }).observe(chart);
update();
