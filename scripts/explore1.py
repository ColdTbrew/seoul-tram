#!/usr/bin/env python3
"""Étape 1 : explorer le GTFS KTDB (compter les trips/arrêts de la région de Séoul)."""
from __future__ import annotations

import csv
import io
import json
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ZIP = ROOT / "data/raw/GTFS_Korea.zip"
OUT = ROOT / "data/explore"
OUT.mkdir(parents=True, exist_ok=True)

PREFIX = ("RR_ACC1_S-1-", "GTX_")


def main() -> None:
    z = zipfile.ZipFile(ZIP)

    routes = {}
    with io.TextIOWrapper(z.open("GTFS_Korea/routes.txt"), "utf-8-sig") as f:
        for row in csv.DictReader(f):
            if row["route_id"].startswith(PREFIX):
                routes[row["route_id"]] = row

    print(f"routes filtrées: {len(routes)}")

    trips_per_route = Counter()
    shape_per_route = defaultdict(set)
    trip_route = {}
    n = 0
    with io.TextIOWrapper(z.open("GTFS_Korea/trips.txt"), "utf-8-sig") as f:
        for row in csv.DictReader(f):
            n += 1
            rid = row["route_id"]
            if rid in routes:
                trips_per_route[rid] += 1
                trip_route[row["trip_id"]] = rid
                shape_per_route[rid].add(row["shape_id"])
    print(f"trips.txt lignes lues: {n:,}")
    print(f"trips des lignes S-1/GTX: {len(trip_route):,}")

    with open(OUT / "trips_s1.txt", "w", encoding="utf-8", newline="") as fh:
        fh.write("trip_id,route_id,shape_id\n")
        for tid, rid in trip_route.items():
            fh.write(f"{tid},{rid},{sorted(shape_per_route[rid])[0] if shape_per_route[rid] else ''}\n")

    # stop_times filtrés
    kept = 0
    total = 0
    per_route_stops = Counter()
    with io.TextIOWrapper(z.open("GTFS_Korea/stop_times.txt"), "utf-8-sig") as f:
        rd = csv.reader(f)
        header = next(rd)
        with open(OUT / "stop_times_s1.txt", "w", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(header)
            for row in rd:
                total += 1
                tid = row[0]
                if tid in trip_route:
                    w.writerow(row)
                    kept += 1
                    per_route_stops[trip_route[tid]] += 1
    print(f"stop_times total: {total:,}  gardés: {kept:,}")

    print("\n== trips par ligne ==")
    for rid, c in sorted(trips_per_route.items(), key=lambda kv: -kv[1]):
        r = routes[rid]
        print(f"{rid:28s} {r['route_long_name'][:34]:36s} trips={c:6d} stop_times={per_route_stops[rid]:8d}")

    sizes = [(i.filename, i.file_size, i.compress_size) for i in z.infolist()]
    print("\n== tailles ==")
    for name, u, c in sizes:
        print(f"{name:34s} {u/1e6:9.1f} MB -> {c/1e6:8.1f} MB")


if __name__ == "__main__":
    main()
