"""Compare adsorption models by holding out an entire archived NIST series."""

import argparse
import csv
import hashlib
import json
import urllib.request
from pathlib import Path

import matplotlib
import matplotlib.pyplot as plt

from caso_nist import DATASET, REPOSITORY, REVISION, adsorpqc, np, read_reference, scipy

DATASET_PATH = DATASET.removesuffix("LogisticModel.json")
MODELS = {
    "Langmuir": ("#986128", "o"),
    "Dual-Site Langmuir": ("#00685f", "s"),
    "Sips": ("#3949ab", "^"),
    "Toth": ("#8f477e", "D"),
}
PRESSURE_LIMIT_BAR = 45


def load_series(input_dir):
    series, sources = {}, {}
    for number in range(1, 14):
        name = f"Lab{number:02d}"
        relative_path = f"{DATASET_PATH}{name}.json"
        source = f"{REPOSITORY}/{REVISION}/{relative_path}"
        if input_dir is None:
            with urllib.request.urlopen(source, timeout=30) as response:
                raw = response.read()
        else:
            raw = (input_dir / Path(relative_path).name).read_bytes()
        pressure, loading = read_reference(raw)
        keep = (pressure > 0) & (pressure <= PRESSURE_LIMIT_BAR)
        series[name] = (pressure[keep], loading[keep])
        sources[name] = {
            "url": source,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "original_rows": pressure.size,
            "rows_after_pressure_filter": int(keep.sum()),
        }
    return series, sources


def evaluate(series):
    rows = []
    for name, (pressure, loading) in series.items():
        other_series = [points for other, points in series.items() if other != name]
        train_pressure, train_loading = (np.concatenate(axis) for axis in zip(*other_series))
        minimum, maximum = train_pressure.min(), train_pressure.max()
        in_range = (pressure >= minimum) & (pressure <= maximum)
        test_pressure, test_loading = pressure[in_range], loading[in_range]
        if test_pressure.size == 0:
            raise ValueError(f"La serie {name} quedó fuera del rango de ajuste.")
        fits = adsorpqc.fit_all_isotherm_models(train_pressure, train_loading)["models"]
        if set(fits) != set(MODELS):
            raise ValueError(f"Faltan modelos en {name}. Ajustes disponibles: {list(fits)}.")
        for model in MODELS:
            residual = fits[model].fitted_function(test_pressure) - test_loading
            rmse = float(np.sqrt(np.mean(residual ** 2)))
            if not np.isfinite(rmse):
                raise ValueError(f"Error no finito en {name}, {model}.")
            rows.append({
                "serie_reservada": name,
                "modelo": model,
                "puntos_ajuste": train_pressure.size,
                "puntos_evaluados": test_pressure.size,
                "fuera_rango_ajuste": int((~in_range).sum()),
                "presion_min_ajuste_bar": float(minimum),
                "presion_max_ajuste_bar": float(maximum),
                "rmse_mol_kg": rmse,
            })
    return rows


def save_figure(rows, names, output):
    figure, axis = plt.subplots(figsize=(8.6, 6), layout="constrained")
    positions = np.arange(len(names))
    for (model, (color, marker)), offset in zip(MODELS.items(), (-.24, -.08, .08, .24)):
        errors = [row["rmse_mol_kg"] for row in rows if row["modelo"] == model]
        axis.scatter(errors, positions + offset, c=color, marker=marker, label=model, s=24)
    axis.set_yticks(positions, names)
    axis.invert_yaxis()
    axis.set_xlim(left=0)
    axis.set_xlabel("RMSE sobre la serie reservada (mol/kg)")
    axis.grid(axis="y", alpha=.16)
    axis.spines[["top", "right", "left"]].set_visible(False)
    figure.legend(loc="outside lower center", ncols=2, frameon=False)
    figure.savefig(output, dpi=220)
    plt.close(figure)


def build(input_dir, output):
    series, sources = load_series(input_dir)
    rows = evaluate(series)
    means = {
        model: float(np.mean([row["rmse_mol_kg"] for row in rows if row["modelo"] == model]))
        for model in MODELS
    }
    first_model = [row for row in rows if row["modelo"] == next(iter(MODELS))]
    metadata = {
        "doi": "10.1007/s10450-018-9958-x",
        "data_revision": REVISION,
        "pressure_filter": f"0 < p <= {PRESSURE_LIMIT_BAR} bar",
        "validation_unit": "one archived series, not a laboratory",
        "scoring_rule": "only measured test points within training pressure range",
        "mean_rule": "arithmetic mean of per-series RMSE with equal weight for each series",
        "archived_series": len(series),
        "archived_rows": sum(item["original_rows"] for item in sources.values()),
        "evaluated_rows": sum(row["puntos_evaluados"] for row in first_model),
        "excluded_outside_training_range": sum(row["fuera_rango_ajuste"] for row in first_model),
        "adsorpqc": adsorpqc.__version__,
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "matplotlib": matplotlib.__version__,
        "mean_rmse_mol_kg": means,
        "series": sources,
    }
    output.mkdir(parents=True, exist_ok=True)
    with (output / "errores-series-nist.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0])
        writer.writeheader()
        writer.writerows(rows)
    (output / "series-nist.json").write_text(json.dumps(metadata, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    save_figure(rows, list(series), output / "figura-series-nist.png")
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--input-dir", type=Path, help="Use local copies of the 13 pinned NIST JSON files")
    args = parser.parse_args()
    metadata = build(args.input_dir, args.output)
    print(json.dumps(metadata["mean_rmse_mol_kg"], indent=2))


if __name__ == "__main__":
    main()
