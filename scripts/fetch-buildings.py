"""Bounded Overture building extraction.

Primary method (Overture docs): attach https://stac.overturemaps.org/latest.ddb
Fallback (one retry): release-pinned GeoParquet on S3
  s3://overturemaps-us-west-2/release/<release>/theme=buildings/type=building/*

Hard timeout: 90 seconds per attempt. On failure, exit 1 without writing
the tiny-region cache or overwriting an existing successful extract for a
different region.
"""
from __future__ import annotations

import argparse
import datetime
import json
import multiprocessing as mp
import pathlib
import tempfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
REGIONS = {
    "richardson-central-test": [-96.731, 32.950, -96.727, 32.954],
    "richardson-north-central-study": [-96.755, 32.935, -96.705, 32.975],
}
MAX_FEATURES = {
    "richardson-central-test": 1000,
    "richardson-north-central-study": 10000,
}
HARD_TIMEOUT_SECONDS = 90


def latest_release() -> str:
    with urllib.request.urlopen("https://stac.overturemaps.org/catalog.json", timeout=30) as response:
        release = json.load(response).get("latest")
    if not release:
        raise RuntimeError("Overture STAC catalog did not advertise a latest release")
    return release


def _rows_to_features(rows):
    features = []
    for row in rows:
        geom = row[5]
        if isinstance(geom, str):
            geom = json.loads(geom)
        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "id": str(row[0]),
                "name": row[1],
                "class": row[2],
                "height": row[3],
                "num_floors": row[4],
            },
        })
    return features


def extract_latest_ddb(bbox, limit):
    import duckdb
    con = duckdb.connect()
    con.execute("INSTALL spatial")
    con.execute("LOAD spatial")
    con.execute("INSTALL httpfs")
    con.execute("LOAD httpfs")
    con.execute("ATTACH 'https://stac.overturemaps.org/latest.ddb' AS overture (READ_ONLY)")
    w, s, e, n = bbox
    sql = f"""
      SELECT id, names.primary AS name, class, height, num_floors, ST_AsGeoJSON(geometry) AS geometry
      FROM overture.building
      WHERE bbox.xmin < {e} AND bbox.xmax > {w} AND bbox.ymin < {n} AND bbox.ymax > {s}
      LIMIT {limit + 1}
    """
    rows = con.execute(sql).fetchall()
    return _rows_to_features(rows), "DuckDB latest.ddb (https://stac.overturemaps.org/latest.ddb)"


def extract_geoparquet(bbox, limit, release):
    import duckdb
    con = duckdb.connect()
    con.execute("INSTALL spatial")
    con.execute("LOAD spatial")
    con.execute("INSTALL httpfs")
    con.execute("LOAD httpfs")
    con.execute("SET s3_region='us-west-2'")
    w, s, e, n = bbox
    sources = [
        f"s3://overturemaps-us-west-2/release/{release}/theme=buildings/type=building/*",
        f"https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/{release}/theme=buildings/type=building/*",
    ]
    last_error = None
    for parquet in sources:
        sql = f"""
          SELECT id, names.primary AS name, class, height, num_floors, ST_AsGeoJSON(geometry) AS geometry
          FROM read_parquet('{parquet}', hive_partitioning=1)
          WHERE bbox.xmin < {e} AND bbox.xmax > {w} AND bbox.ymin < {n} AND bbox.ymax > {s}
          LIMIT {limit + 1}
        """
        try:
            rows = con.execute(sql).fetchall()
            return _rows_to_features(rows), f"release-pinned GeoParquet {parquet}"
        except Exception as error:  # noqa: BLE001
            last_error = error
    raise RuntimeError(last_error)


def _worker(queue, method, bbox, limit, release, out_path):
    try:
        if method == "latest.ddb":
            features, method_used = extract_latest_ddb(bbox, limit)
        else:
            features, method_used = extract_geoparquet(bbox, limit, release)
        with open(out_path, "w") as handle:
            json.dump(features, handle)
        queue.put(("ok", method_used, len(features)))
    except Exception as error:  # noqa: BLE001 — surface any DuckDB/network failure to parent
        queue.put(("err", f"{type(error).__name__}: {error}"))


def run_with_timeout(method, bbox, limit, release, timeout=HARD_TIMEOUT_SECONDS):
    ctx = mp.get_context("spawn")
    queue = ctx.Queue()
    raw_dir = ROOT / "data/buildings/raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", delete=False, dir=raw_dir, suffix=".features.tmp") as handle:
        out_path = handle.name
    process = ctx.Process(target=_worker, args=(queue, method, bbox, limit, release, out_path))
    process.start()
    process.join(timeout)
    if process.is_alive():
        process.terminate()
        process.join(5)
        pathlib.Path(out_path).unlink(missing_ok=True)
        raise TimeoutError(f"{method} exceeded hard timeout of {timeout}s")
    try:
        if queue.empty():
            raise RuntimeError(f"{method} exited without a result")
        status, *payload = queue.get()
        if status == "err":
            raise RuntimeError(payload[0])
        method_used, count = payload
        with open(out_path) as handle:
            features = json.load(handle)
        if len(features) != count:
            raise RuntimeError(f"{method} wrote {len(features)} features but reported {count}")
        return features, method_used
    finally:
        pathlib.Path(out_path).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", default="richardson-central-test", choices=REGIONS)
    args = parser.parse_args()
    region = args.region
    bbox = REGIONS[region]
    limit = MAX_FEATURES[region]

    raw_dir = ROOT / "data/buildings/raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    out = raw_dir / f"overture-{region}.geojson"
    meta = raw_dir / f"overture-{region}.metadata.json"

    print(f"Fetching Overture buildings for {region} bbox={bbox} (hard timeout {HARD_TIMEOUT_SECONDS}s)")

    try:
        release = latest_release()
    except Exception as error:  # noqa: BLE001
        raise SystemExit(f"Failed to read Overture STAC catalog: {error}") from error

    errors = []
    features = None
    method_used = None
    try:
        print("Attempt 1: DuckDB latest.ddb …")
        features, method_used = run_with_timeout("latest.ddb", bbox, limit, release)
        print(f"  succeeded via {method_used}")
    except Exception as error:  # noqa: BLE001
        errors.append(f"latest.ddb: {error}")
        print(f"  failed: {error}")
        print("Attempt 2 (only retry): release-pinned GeoParquet …")
        try:
            features, method_used = run_with_timeout("geoparquet", bbox, limit, release)
            print(f"  succeeded via {method_used}")
        except Exception as retry_error:  # noqa: BLE001
            errors.append(f"geoparquet: {retry_error}")
            print(f"  failed: {retry_error}")

    if features is None:
        raise SystemExit(
            "Live Overture fetch failed; existing caches were not modified.\n" + "\n".join(errors)
        )

    truncated = False
    if len(features) > limit:
        print(f"  bbox contains more than {limit} buildings; writing the first {limit} (not unbounded)")
        features = features[:limit]
        truncated = True

    payload = {"type": "FeatureCollection", "features": features}
    json.loads(json.dumps(payload))
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    metadata = {
        "provider": "Overture Maps",
        "dataset": "buildings/building",
        "datasetRelease": release,
        "acquiredAt": now,
        "bbox": bbox,
        "regionId": region,
        "extractionMethod": method_used,
        "rawRecordCount": len(features),
        "truncatedToLimit": truncated,
        "schemaVersion": 2,
    }

    with tempfile.NamedTemporaryFile("w", delete=False, dir=raw_dir, suffix=".tmp") as handle:
        json.dump(payload, handle)
        tmp = pathlib.Path(handle.name)
    with tempfile.NamedTemporaryFile("w", delete=False, dir=raw_dir, suffix=".tmp") as handle:
        json.dump(metadata, handle)
        metatmp = pathlib.Path(handle.name)
    tmp.replace(out)
    metatmp.replace(meta)
    print(json.dumps({
        "regionId": region,
        "rawRecordCount": len(features),
        "datasetRelease": release,
        "extractionMethod": method_used,
        "rawPath": str(out),
    }))


if __name__ == "__main__":
    main()
