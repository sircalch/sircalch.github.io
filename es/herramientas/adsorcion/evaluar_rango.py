"""Compare interpolated and high-pressure holdouts for a pinned NIST curve."""

import argparse
import csv
import hashlib
import json
import urllib.request
from pathlib import Path

import matplotlib
import matplotlib.pyplot as plt

from caso_nist import SOURCE, adsorpqc, np, read_reference, scipy

EXPECTED_SHA256 = '5a02f206291a6621a076cf6d2651366bce5cba7c15aa5128d7f581603cf5ad15'
COLORS = {'Langmuir': '#986128', 'Dual-Site Langmuir': '#00685f', 'Sips': '#3949ab', 'Toth': '#8f477e'}
STYLE = {'Langmuir': ':', 'Dual-Site Langmuir': '-', 'Sips': '--', 'Toth': '-.'}


def build(raw, output):
    checksum = hashlib.sha256(raw).hexdigest()
    if checksum != EXPECTED_SHA256:
        raise ValueError('La huella de la tabla no coincide con la revisión de referencia.')
    pressure, loading = read_reference(raw)
    interleaved = np.arange(len(pressure)) % 5 == 4
    highest = np.arange(len(pressure)) >= len(pressure) - interleaved.sum()
    assert int(interleaved.sum()) == int(highest.sum()) == 23
    assert pressure[~highest].max() < pressure[highest].min()

    figure, axes = plt.subplots(1, 2, figsize=(11.3, 4.4), sharex=True, sharey=True, layout='constrained')
    metadata = {'source': SOURCE, 'input_sha256': checksum, 'adsorpqc': adsorpqc.__version__, 'numpy': np.__version__,
                'scipy': scipy.__version__, 'matplotlib': matplotlib.__version__, 'schemes': []}
    csv_rows = []
    grid = np.linspace(pressure.min(), pressure.max(), 420)
    for axis, mask, label in zip(axes, (interleaved, highest), ('Puntos intercalados', 'Extremo de alta presión')):
        fit_x, fit_y = pressure[~mask], loading[~mask]
        test_x, test_y = pressure[mask], loading[mask]
        fits = adsorpqc.fit_all_isotherm_models(fit_x, fit_y)
        if set(fits['models']) != set(COLORS):
            raise ValueError(f'Modelos inesperados en {label}: {list(fits["models"])}.')
        if label == 'Extremo de alta presión':
            axis.axvspan(fit_x.max(), test_x.max(), color='#ede7f6', zorder=0)
            axis.axvline(fit_x.max(), color='#63577b', linewidth=1, linestyle='--')
        for name, fit in fits['models'].items():
            predictions = fit.fitted_function(test_x)
            rmse = float(np.sqrt(np.mean((predictions - test_y) ** 2)))
            if not np.isfinite(rmse):
                raise ValueError(f'La evaluación de {name} en {label} produjo un error no finito.')
            csv_rows.append((label, name, f'{rmse:.8f}'))
            axis.plot(grid, fit.fitted_function(grid), color=COLORS[name], linestyle=STYLE[name], linewidth=1.7, label=name)
        axis.scatter(fit_x, fit_y, color='#46556a', s=6, alpha=.65, zorder=3, label='Filas de ajuste')
        axis.scatter(test_x, test_y, color='#152137', s=23, marker='x', zorder=4, label='Filas reservadas')
        axis.set_title(label, fontsize=13, fontweight='bold', loc='left')
        axis.set_xlabel('Presión (bar)')
        axis.grid(alpha=.15)
        axis.spines[['top', 'right']].set_visible(False)
        metadata['schemes'].append({'name': label, 'fit_rows': int(fit_x.size), 'test_rows': int(test_x.size),
                                    'fit_max_bar': float(fit_x.max()), 'test_min_bar': float(test_x.min()),
                                    'test_max_bar': float(test_x.max()), 'fit_aicc_winner': fits['best_model_name']})
    axes[0].set_ylabel('Adsorción excedente (mol/kg)')
    figure.legend(*axes[0].get_legend_handles_labels(), loc='outside lower center', ncols=3, frameon=False)

    output.mkdir(parents=True, exist_ok=True)
    with (output / 'errores-rango-presion.csv').open('w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['particion', 'modelo', 'rmse_mol_kg'])
        writer.writerows(csv_rows)
    (output / 'particiones-presion.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    figure.savefig(output / 'figura-rango-presion.png', dpi=220)
    plt.close(figure)
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--input', type=Path, help='Read the pinned NIST JSON from a local copy')
    args = parser.parse_args()
    if args.input:
        raw = args.input.read_bytes()
    else:
        with urllib.request.urlopen(SOURCE, timeout=30) as response:
            raw = response.read()
    print(json.dumps(build(raw, args.output), indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
