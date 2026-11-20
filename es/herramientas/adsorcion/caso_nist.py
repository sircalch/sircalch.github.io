"""Fit AdsorpQC isotherm models to a fixed NIST reference table and score held-out rows."""
import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

import adsorpqc
import numpy as np
import scipy

REPOSITORY = "https://raw.githubusercontent.com/NIST-ISODB/isodb-library"
REVISION = "9e1ee472967d66ec7845e23c5d5b986eca5ff020"
DATASET = "Library/10.1007s104500189958x/10.1007s10450-018-9958-x.LogisticModel.json"
SOURCE = f"{REPOSITORY}/{REVISION}/{DATASET}"
INCHI_KEY = "CURLTUGMZLYLDI-UHFFFAOYSA-N"


def evaluate(raw):
    data = json.loads(raw)
    expected = {"DOI": "10.1007/s10450-018-9958-x", "temperature": 293, "pressureUnits": "bar",
                "adsorptionUnits": "mmol/g", "isotherm_type": "excess"}
    if any(data[field] != value for field, value in expected.items()):
        raise ValueError("Incompatible data provenance or units")
    rows = [
        (row["pressure"], next(species["adsorption"] for species in row["species_data"]
                               if species["InChIKey"] == INCHI_KEY))
        for row in data["isotherm_data"]
    ]
    pressure, loading = np.asarray(sorted(rows), dtype=float).T
    if not np.all(np.isfinite([pressure, loading])) or not np.all(np.diff(pressure) > 0):
        raise ValueError("Expected finite data and unique increasing pressures")
    holdout = np.arange(len(pressure)) % 5 == 4
    fits = adsorpqc.fit_all_isotherm_models(pressure[~holdout], loading[~holdout])
    if not fits["models"]:
        raise RuntimeError("AdsorpQC produced no fits")
    return {
        "source": SOURCE, "input_sha256": hashlib.sha256(raw).hexdigest(),
        "adsorpqc": adsorpqc.__version__, "numpy": np.__version__, "scipy": scipy.__version__,
        "calibration_rows": int((~holdout).sum()), "evaluation_rows": int(holdout.sum()),
        "lowest_calibration_aicc": fits["best_model_name"],
        "held_out_rmse_mol_kg": {
            name: round(float(np.sqrt(np.mean((fit.fitted_function(pressure[holdout]) - loading[holdout]) ** 2))), 8)
            for name, fit in fits["models"].items()
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Use a local copy of the pinned NIST JSON")
    args = parser.parse_args()
    if args.input:
        raw = args.input.read_bytes()
    else:
        with urllib.request.urlopen(SOURCE, timeout=30) as response:
            raw = response.read()
    print(json.dumps(evaluate(raw), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
