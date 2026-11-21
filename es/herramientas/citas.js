const form = document.querySelector('#citation-form');
const status = document.querySelector('#citation-status');
const cffPreview = document.querySelector('#cff-preview');
const plainPreview = document.querySelector('#plain-preview');
const cffButton = document.querySelector('#download-cff');
const plainButton = document.querySelector('#download-citation');

function yamlText(text) {
  return JSON.stringify(text).replace(/[\u0085\u2028\u2029]/g, character =>
    '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

function readAuthors(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
    if (/^equipo:/i.test(line)) {
      const name = line.slice(7).trim();
      if (name) return { name };
    } else {
      const parts = line.split(',').map(part => part.trim());
      if (parts.length === 2 && parts.every(Boolean)) {
        return { 'family-names': parts[0], 'given-names': parts[1] };
      }
    }
    throw new Error(`Revisa el formato del autor en la línea ${index + 1}.`);
  });
}

function formatCitation({ title, version, authors, released, doi, repository }) {
  const fields = [
    'cff-version: "1.2.0"',
    'message: "If you use this software, please cite it using these metadata."',
    'type: software',
    `title: ${yamlText(title)}`,
    `version: ${yamlText(version)}`,
    'authors:',
  ];
  for (const author of authors) {
    if (author.name) {
      fields.push(`  - name: ${yamlText(author.name)}`);
    } else {
      fields.push(`  - family-names: ${yamlText(author['family-names'])}`, `    given-names: ${yamlText(author['given-names'])}`);
    }
  }
  if (released) fields.push(`date-released: ${yamlText(released)}`);
  if (doi) fields.push(`doi: ${yamlText(doi)}`);
  if (repository) fields.push(`repository-code: ${yamlText(repository)}`);
  const names = authors.map(author => author.name || `${author['family-names']}, ${author['given-names']}`);
  const year = released ? released.slice(0, 4) : 's. f.';
  const link = doi ? `https://doi.org/${doi}` : repository;
  return {
    cff: fields.join('\n') + '\n',
    plain: `${names.join(' y ')} (${year}). ${title} (versión ${version}) [Software].${link ? ' ' + link : ''}`,
  };
}

function clearPreview() {
  cffPreview.value = '';
  plainPreview.value = '';
  cffButton.disabled = true;
  plainButton.disabled = true;
}

form.addEventListener('input', () => {
  clearPreview();
  status.textContent = 'Genera la cita para utilizar los datos actualizados.';
});

form.addEventListener('submit', event => {
  event.preventDefault();
  const values = new FormData(form);
  const get = key => values.get(key).trim();
  clearPreview();
  try {
    const title = get('title');
    const version = get('version');
    const authors = readAuthors(get('authors'));
    if (!title || !version || !authors.length) throw new Error('Agrega el nombre, la versión y al menos un autor.');
    const doi = get('doi').replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
    if (doi && !/^10\.\d{4,9}\/[^\s\p{Cc}]+$/u.test(doi)) throw new Error('Revisa el formato del DOI de la versión.');
    const repoText = get('repository');
    const repository = repoText ? new URL(repoText) : null;
    if (repository && (!['http:', 'https:'].includes(repository.protocol) || repository.username || repository.password)) {
      throw new Error('El repositorio necesita una URL HTTP o HTTPS sin credenciales.');
    }
    const result = formatCitation({ title, version, authors, released: get('released'), doi, repository: repository?.href });
    cffPreview.value = result.cff;
    plainPreview.value = result.plain;
    cffButton.disabled = false;
    plainButton.disabled = false;
    status.textContent = 'Cita lista para descargar. Comprueba la versión y el DOI antes de publicarla.';
  } catch (error) {
    status.textContent = error.message;
  }
});

document.querySelector('#citation-example').addEventListener('click', () => {
  form.elements.title.value = 'Atlas de mediciones (ejemplo ficticio)';
  form.elements.version.value = '1.0.0';
  form.elements.authors.value = 'López Vega, Nuria\nEquipo: Taller de Señales';
  form.elements.released.value = '2026-01-15';
  form.elements.doi.value = '';
  form.elements.repository.value = 'https://example.org/atlas-mediciones';
  form.requestSubmit();
});

function download(filename, content) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

cffButton.addEventListener('click', () => download('CITATION.cff', cffPreview.value));
plainButton.addEventListener('click', () => download('cita-software.txt', plainPreview.value + '\n'));
form.querySelector('[type="submit"]').disabled = false;
