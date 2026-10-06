#!/usr/bin/env python3
"""build_data.py — "서울 지하철로 몇 분?" 데이터 빌드.

`data/raw/GTFS_Korea.zip`(KTDB 국가교통DB 전국 GTFS, Hugging Face
`Digital-Twin-Urban-Mobility/GTFS-Korea` 미러)을 스트리밍으로 읽어 사이트가 쓸 JSON을 만든다:

    public/data/network.json  — 지도/그래프: 승강장(stop) 노드, 승차·도보 간선, 노선색과 선형
    public/data/rankings.json — 순위 페이지용 통계(배차 추정, 역별 정차 횟수, 최장 소요 노선, 시청 기준 등)

원본 3 GB를 전부 풀지 않고 member별로 필요 행만 스트리밍 필터링한다(shapes.txt 1.58 GB,
stop_times.txt 1.52 GB 포함 — 줄 단위 스트리밍이라 파일 전체를 메모리에 올리지 않는다).

포함 범위: route_id가 `RR_ACC1_S-1-`로 시작하는 route_type=1 노선(자기부상열차 ET 제외 — 폐지됨).
`GTX_`는 부분 개통/계획 구간이라 이 GTFS의 기하·시각이 실제와 다를 수 있어 제외한다(README 한계 참조).

계산 모델 (tram.camilleroux.com의 "Modèle"을 서울 데이터에 맞게 적용):
  * 역간(승강장 간) 소요 = 계획된 소요시간의 중앙값 (평일 7~20시 운행에서)
  * 대기 = 배차간격의 절반, 1~15분으로 제한. 배차간격 = 승강장별 7~20시 연속 출발 간격의
    중앙값(노선별 → 승강장 중앙값). (route, stop, 출발시) 중복 행은 제거하고 계산한다.
  * 환승 = 환승 도보 + 다음 노선 대기 (도보 75 m/분, 직선거리)
  * 승차 간선으로 직접 이어지지 않은 450 m 미만 승강장쌍은 도보로 연결(환승·단거리 도보)

Usage:
    python3 scripts/build_data.py            # public/data/*.json 생성 + 검증 출력
"""
from __future__ import annotations

import heapq
import json
import math
import statistics
import sys
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ZIP = ROOT / "data/raw/GTFS_Korea.zip"
OUT = ROOT / "public" / "data"   # Vite 가 public/ 을 dist/ 루트로 복사 — 앱은 /data/… 가 아닌 BASE_URL 상대경로로 fetch

WALK_SPEED = 75.0             # m/분, 직선거리 (원본 모델과 동일)
ACCESS_RADIUS = 1200.0        # 출발지가 임의 지점일 때 도보로 잡는 승강장 반경 (m)
INTER_WALK_RADIUS = 450.0     # 승차 간선으로 직접 연결되지 않은 승강장쌍을 도보로 잇는 반경 (m)
MIN_WAIT, MAX_WAIT = 1.0, 15.0
SERVICE_WINDOW = (7 * 3600, 20 * 3600)
MAX_EDGE_MINUTES = 45.0       # 이상치(데이터 오류로 보이는 초장역 구간) 제외용 상한
MAX_HEADWAY_GAP = 120.0       # 배차간격 추정에서 이보다 큰 출발 간격은 운영 공백으로 보고 제외
REVISIT_GAP_MIN = 10.0      # 같은 트립이 10분 이상 띄우고 같은 승강장을 다시 지나면 "되감기"로 보고 버림
SAMPLE_GAP_M = 500.0          # 노선 선형 간격샘플링 간격
MAX_PATHS_PER_LINE = 4        # 노선당 저장하는 shape 개수

KT_PREFIX = "RR_ACC1_S-1-"
KT_EXCLUDE = ("RR_ACC1_S-1-ET-",)  # 자기부상열차: 폐지됨 → 제외

# 노선색: 널리 쓰이는 공식 노선색 근사치 (지도 가독성용 근사치이며 정확한 지정 코드는 확인하지 못함).
LINE_COLORS = {
    "S-1-01": "#0052A4", "S-1-02": "#00A84D", "S-1-03": "#EF7C1C", "S-1-04": "#00A5DE",
    "S-1-05": "#996CAC", "S-1-06": "#CD7C2F", "S-1-07": "#747F00", "S-1-08": "#E6186C",
    "S-1-09": "#BDB092", "S-1-AP": "#0090D2", "S-1-SB": "#D4003B", "S-1-SD": "#FABE00",
    "S-1-KJ": "#77C4A3", "S-1-GC": "#0C8E72", "S-1-KK": "#0054A6", "S-1-SH": "#8FC31F",
    "S-1-I1": "#7CA8D5", "S-1-I2": "#ED8B00", "S-1-WS": "#B0CE18", "S-1-UI": "#FDA600",
    "S-1-EB": "#509F22", "S-1-KP": "#A17800",
}

LINE_NAMES = {
    "S-1-01": "서울 1호선", "S-1-02": "서울 2호선", "S-1-03": "서울 3호선", "S-1-04": "서울 4호선",
    "S-1-05": "서울 5호선", "S-1-06": "서울 6호선", "S-1-07": "서울 7호선", "S-1-08": "서울 8호선",
    "S-1-09": "서울 9호선", "S-1-AP": "공항철도", "S-1-SB": "신분당선", "S-1-SD": "수인분당선",
    "S-1-KJ": "경의중앙선", "S-1-GC": "경춘선", "S-1-KK": "경강선", "S-1-SH": "서해선",
    "S-1-I1": "인천 1호선", "S-1-I2": "인천 2호선", "S-1-WS": "우이신설선", "S-1-UI": "의정부경전철",
    "S-1-EB": "용인에버라인", "S-1-KP": "김포골드라인",
}


def line_key_of(route_id: str) -> str:
    """`RR_ACC1_S-1-02-1I` → `S-1-02`."""
    return "S-1-" + route_id[len(KT_PREFIX) :].split("-")[0]


def haversine(a, b):
    lon1, lat1 = a
    lon2, lat2 = b
    x = (lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2.0)) * 111_320.0
    y = (lat2 - lat1) * 111_320.0
    return math.hypot(x, y)


def iter_lines(z: zipfile.ZipFile, member: str, chunk: int = 1 << 22):
    """zip member를 한 줄씩 스트리밍 (解压된 전체 파일을 메모리에 올리지 않음)."""
    with z.open(member) as raw:
        buf = b""
        while True:
            block = raw.read(chunk)
            if not block:
                if buf:
                    text = buf.decode("utf-8", "replace")
                    for line in text.splitlines():
                        if line:
                            yield line
                break
            buf += block
            *lines, buf = buf.split(b"\n")
            if lines:
                text = b"\n".join(lines).decode("utf-8", "replace")
                for line in text.splitlines():
                    if line:
                        yield line


def parse_hhmmss(value: str) -> float:
    h, m, s = value.split(":")
    return int(h) * 3600 + int(m) * 60 + int(float(s))


def round5(v: float) -> float:
    return round(v, 5)


# -------------------------------------------------------------------- GTFS 읽기 (스트리밍)


def load_routes(z):
    """수도권 지하철/광역철도 route만 고른다. {route_id: {name, line}}"""
    routes = {}
    for line in iter_lines(z, "GTFS_Korea/routes.txt"):
        row = line.rstrip("\r").split(",")
        if len(row) < 5 or row[0] == "route_id":
            continue
        rid = row[0]
        if not rid.startswith(KT_PREFIX) or rid.startswith(KT_EXCLUDE):
            continue
        routes[rid] = {"name": row[3].strip("<>") or row[2], "line": line_key_of(rid)}
    return routes


def load_trips(z, routes):
    """{trip_id: (route_id, shape_id)} — 서울 노선의 trip만."""
    trips = {}
    for line in iter_lines(z, "GTFS_Korea/trips.txt"):
        if line[:8] == "route_id":
            continue
        row = line.rstrip("\r").split(",")
        if len(row) < 4:
            continue
        if row[0] in routes:
            trips[row[2]] = (row[0], row[3])
    return trips


def load_stop_times(z, trips):
    """trip별 [(stop_id, 출발시)]. 20,858,699행 중 서울 trip 관련 행만 남긴다."""
    per_trip = defaultdict(list)
    skipped = 0
    for line in iter_lines(z, "GTFS_Korea/stop_times.txt"):
        if line[:8] == "trip_id,":
            continue
        row = line.rstrip("\r").split(",")
        if len(row) < 5:
            continue
        tid = row[0]
        if tid in trips:
            try:
                dep = parse_hhmmss(row[2])
            except ValueError:
                skipped += 1
                continue
            per_trip[tid].append((row[3], dep))
    if skipped:
        print(f"  (시각 오류 행 {skipped}개 제외)")
    return per_trip


def load_shapes(z, shape_ids):
    """shapes.txt(解压 1.58 GB)를 스트리밍하며 필요한 shape_id만, 약 SAMPLE_GAP_M 간격으로 간격샘플링."""
    shapes = {}
    if not shape_ids:
        return shapes
    last = {}
    for line in iter_lines(z, "GTFS_Korea/shapes.txt"):
        row = line.rstrip("\r").split(",")
        if len(row) < 4 or row[0] == "shape_id":
            continue
        sid = row[0]
        if sid not in shape_ids:
            continue
        try:
            point = (float(row[1]), float(row[2]))
        except ValueError:
            continue
        prev = last.get(sid)
        if prev is None or haversine(prev, point) >= SAMPLE_GAP_M:
            shapes.setdefault(sid, []).append(point)
            last[sid] = point
    return shapes


def load_stops(z, used_stop_ids):
    stops = {}
    for line in iter_lines(z, "GTFS_Korea/stops.txt"):
        row = line.rstrip("\r").split(",")
        if len(row) < 4 or row[0] == "stop_id":
            continue
        if row[0] in used_stop_ids:
            stops[row[0]] = {"name": row[1], "lat": float(row[2]), "lon": float(row[3])}
    return stops


# ------------------------------------------------------------------------- 그래프 모델


def collect_samples(per_trip, trips, stops):
    """(route, stop) 출발시각 표본과 (stopA, stopB) 소요시간 표본을 모은다.

    - 출발시각은 (route, stop, 시각) 중복을 제거해 센다(집합으로 dedup). 배차간격 =
      7~20시 연속 출발 간격의 중앙값(노선별). 승강장에서는 노선별 값의 중앙값을 쓴다.
    - 승강장쌍 소요는 trip 안의 인접 정차쌍(양방향 합쳐 중앙값). 광역 버금 구간(예: 오도~마전,
      운서~검암)은 실제 운행이라 보존하고, 같은 승강장을 10분 이상 띄우고 다시 지나는 "되감기"만 버린다.
    """
    dep_series = defaultdict(set)      # (route_id, stop_id) -> {출발 초}
    ride_samples = defaultdict(list)   # frozenset({a, b}) -> [분]
    ride_lines = defaultdict(set)      # frozenset -> {노선 키}

    for tid, rows in per_trip.items():
        if len(rows) < 2:
            continue
        route = trips[tid][0]
        line = line_key_of(route)
        for stop, dep in rows:
            if SERVICE_WINDOW[0] <= dep < SERVICE_WINDOW[1]:
                dep_series[(route, stop)].add(dep)
        first_time = {}
        for (a, ta), (b, tb) in zip(rows, rows[1:]):
            if a == b:
                continue
            last_seen_b = first_time.get(b)
            first_time.setdefault(a, ta)
            minutes = (tb - ta) / 60.0
            if not (0.1 < minutes <= MAX_EDGE_MINUTES):
                continue
            if not (SERVICE_WINDOW[0] <= ta < SERVICE_WINDOW[1]):
                continue
            if last_seen_b is not None and tb - last_seen_b > REVISIT_GAP_MIN * 60.0:
                continue  # 10분 이상 띄우고 같은 승강장 재통과 = 계획표 단순화로 된 "되감기" (실제 인접 정차가 아님)
            key = frozenset((a, b))
            ride_samples[key].append(minutes)
            ride_lines[key].add(line)

    headways = defaultdict(list)                               # stop_id -> [배차간격(분) …] (노선별 1개)
    headways_by_line = defaultdict(lambda: defaultdict(list))  # line -> stop -> [h …]
    for (route, stop), times in dep_series.items():
        if len(times) < 3:
            continue
        times = sorted(times)
        gaps = [(b - a) / 60.0 for a, b in zip(times, times[1:])]
        gaps = [g for g in gaps if 0.05 < g < MAX_HEADWAY_GAP]
        if len(gaps) >= 3:
            h = statistics.median(gaps)
            line = line_key_of(route)
            headways[stop].append(h)
            headways_by_line[line][stop].append(h)
    return headways, headways_by_line, ride_samples, ride_lines


def wait_minutes(h_list, fallback):
    if h_list:
        return round(min(MAX_WAIT, max(MIN_WAIT, statistics.median(h_list) / 2.0)), 2)
    return round(min(MAX_WAIT, max(MIN_WAIT, fallback / 2.0)), 2)


def build_graph(stops, headways, ride_samples, ride_lines, line_order):
    """브라우저에서 쓸 구조체: stops(노드), edges(간선).

    edges 항목 = [a, b, 분, lineIdx] — lineIdx -1 = 도보 연결. 승차/도보 모두 양방향으로 쓴다.
    """
    stop_ids = list(stops.keys())
    index = {sid: i for i, sid in enumerate(stop_ids)}
    line_idx = {key: i for i, key in enumerate(line_order)}

    finite = [statistics.median(v) for v in headways.values() if v]
    fallback_h = statistics.median(finite) if finite else 8.0

    nodes = []
    for sid in stop_ids:
        s = stops[sid]
        nodes.append({"n": s["name"], "lon": round5(s["lon"]), "lat": round5(s["lat"]),
                      "w": wait_minutes(headways.get(sid, []), fallback_h)})

    ride_pairs = set()
    edges = []
    for key, times in ride_samples.items():
        a, b = sorted(key)
        ia, ib = index.get(a), index.get(b)
        if ia is None or ib is None:
            continue
        if ia > ib:
            ia, ib = ib, ia
        ride_pairs.add((ia, ib))
        used = sorted(ride_lines[key])
        edges.append([ia, ib, round(statistics.median(times), 2), line_idx.get(used[0], 0) if used else 0])

    # 도보 연결: 승차 간선으로 직접 이어지지 않은 450 m 미만 승강장쌍 (원본 모델 규칙).
    cells = defaultdict(list)
    bucket_deg = 0.0045  # 약 500 m
    for i, n in enumerate(nodes):
        cells[(int(n["lon"] / bucket_deg), int(n["lat"] / bucket_deg))].append(i)

    n_walk = 0
    seen = set()
    for (cx, cy), bucket_items in cells.items():
        near = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                near.extend(cells.get((cx + dx, cy + dy), ()))
        for i in bucket_items:
            for j in near:
                if i >= j:
                    continue
                pair = (min(i, j), max(i, j))
                if pair in seen or pair in ride_pairs:
                    continue
                ni, nj = nodes[i], nodes[j]
                d = haversine((ni["lon"], ni["lat"]), (nj["lon"], nj["lat"]))
                if d > INTER_WALK_RADIUS or d < 1.0:
                    continue
                seen.add(pair)
                n_walk += 1
                edges.append([i, j, round(d / WALK_SPEED, 2), -1])
    print(f"  승차 간선 {len(edges) - n_walk}개, 도보 연결 {n_walk}개")
    return nodes, edges, stop_ids


def build_stations(nodes):
    """같은 이름 + 350 m 이내 승강장을 하나의 '역'(클러스터)으로 묶는다 (세기/라벨용)."""
    stations = []
    by_base = defaultdict(list)
    for i, n in enumerate(nodes):
        base = n["n"].split("(")[0].strip()
        found = None
        for ci in by_base[base]:
            s = stations[ci]
            if haversine((s["lon"], s["lat"]), (n["lon"], n["lat"])) < 350.0:
                found = ci
                break
        if found is None:
            found = len(stations)
            by_base[base].append(found)
            stations.append({"n": base, "lon": n["lon"], "lat": n["lat"]})
        n["s"] = found
    return stations


def build_adjacency(edges):
    adj = defaultdict(list)
    for a, b, minutes, line_idx in edges:
        adj[a].append((b, minutes, line_idx))
        adj[b].append((a, minutes, line_idx))
    return adj


def dijkstra(adj, nodes, starts):
    """상태 = (정류장, 승차 중인 노선). 승차를 시작할 때만 대기(배차/2)를 더한다.

    starts: {(stopIdx, -1): 분}. 반환: {(stopIdx, lineIdx): 분}
    같은 노선을 계속 타면 대기를 다시 계산하지 않는다(대기 = 승차/환승 시 1회).
    도보 간선(lineIdx -1)에는 대기를 더하지 않는다.
    """
    best = {}
    heap = []
    for (i, line), minutes in starts.items():
        best[(i, line)] = minutes
        heapq.heappush(heap, (minutes, i, line))
    while heap:
        cost, i, line = heapq.heappop(heap)
        if cost > best.get((i, line), float("inf")) + 1e-9:
            continue
        for j, minutes, line2 in adj[i]:
            if line2 == -1:
                add = minutes                      # 도보 (정류장 접근/환승 도보)
            elif line == line2:
                add = minutes                      # 같은 노선 유지
            else:
                add = minutes + nodes[i]["w"]      # 승차/환승: 대기 + 소요
            state = (j, line2)
            if cost + add < best.get(state, float("inf")) - 1e-9:
                best[state] = cost + add
                heapq.heappush(heap, (cost + add, j, line2))
    return best


# --------------------------------------------------------------------------------- 본체


def main():
    if not ZIP.exists():
        sys.exit(f"원본 GTFS가 없습니다: {ZIP}")
    OUT.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(ZIP) as z:
        print("routes.txt …")
        routes = load_routes(z)
        print(f"  서울 노선 {len(routes)}개")
        print("trips.txt …")
        trips = load_trips(z, routes)
        print(f"  서울 trip {len(trips):,}개")
        print("stop_times.txt (解压 1.52 GB, 스트리밍) …")
        per_trip = load_stop_times(z, trips)
        print(f"  유지한 정차 행 {sum(len(v) for v in per_trip.values()):,}개")
        used_shapes = {shape for shape in (t[1] for t in trips.values()) if shape}
        print(f"shapes.txt (解压 1.58 GB, 필요한 shape_id {len(used_shapes)}개만) …")
        shapes = load_shapes(z, used_shapes)
        print(f"  유지한 선형 점 {sum(len(v) for v in shapes.values()):,}개")
        used_stops = {stop for rows in per_trip.values() for stop, _dep in rows}
        print("stops.txt …")
        stops = load_stops(z, used_stop_ids=used_stops)
        print(f"  유지한 정류장 {len(stops)}개")

    headways, headways_by_line, ride_samples, ride_lines = collect_samples(per_trip, trips, stops)
    line_order = sorted({info["line"] for info in routes.values()})
    nodes, edges, stop_ids = build_graph(stops, headways, ride_samples, ride_lines, line_order)
    stations = build_stations(nodes)
    print(f"\n그래프: 승강장 {len(nodes)}개 (역 클러스터 {len(stations)}개), 간선 {len(edges)}개")

    # 정류장이 속한 노선 (팝업/라벨용)
    stop_lines = defaultdict(set)
    for tid, rows in per_trip.items():
        li = line_order.index(line_key_of(trips[tid][0]))
        for stop, _dep in rows:
            stop_lines[stop].add(li)
    for i, n in enumerate(nodes):
        n["l"] = sorted(stop_lines.get(stop_ids[i], []))

    # 노선 선형 (shape_id는 노선별로 한 번에 최대 MAX_PATHS_PER_LINE개, 길면 간격샘플링)
    line_paths = defaultdict(list)
    seen_shapes = defaultdict(set)
    for tid, (rid, shape_id) in trips.items():
        key = line_key_of(rid)
        if len(seen_shapes[key]) >= MAX_PATHS_PER_LINE or shape_id in seen_shapes[key]:
            continue
        path = shapes.get(shape_id)
        if not path:
            continue
        seen_shapes[key].add(shape_id)
        if len(path) > 900:
            step = -(-len(path) // 700)
            path = path[::step]
        line_paths[key].append([[lon, lat] for lon, lat in path])

    lines_json = [
        {
            "id": key,
            "name": LINE_NAMES.get(key, key),
            "color": LINE_COLORS.get(key, "#777777"),
            "routes": sorted(rid for rid, info in routes.items() if info["line"] == key),
            "paths": line_paths.get(key, []),
        }
        for key in line_order
    ]

    network = {
        "meta": {
            "name": "서울 지하철로 몇 분?",
            "walkSpeed": WALK_SPEED,
            "accessRadius": ACCESS_RADIUS,
            "defaultFrom": {"lon": 126.9754, "lat": 37.5636, "name": "시청"},
            "sources": "KTDB 국가교통DB 전국 GTFS (Hugging Face GTFS-Korea 미러) · OSM 타일 © OpenStreetMap contributors (ODbL)",
            "generated": date.today().isoformat(),
        },
        "stops": nodes,
        "edges": edges,
        "lines": lines_json,
        "stations": stations,
    }
    out_network = OUT / "network.json"
    out_network.write_text(json.dumps(network, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"\nnetwork.json {(out_network.stat().st_size) / 1e6:.2f} MB")

    # ------------------------------------------------------------------ 검증 (상식 체크)
    adj = build_adjacency(edges)

    def find_stops(name):
        return [i for i, n in enumerate(nodes) if n["n"] == name]

    def trip_minutes(a_name, b_name):
        a, b = find_stops(a_name), find_stops(b_name)
        if not a or not b:
            return f"{a_name} → {b_name}: 승강장을 찾지 못함"
        states = dijkstra(adj, nodes, {(i, -1): 0.0 for i in a})
        bset = set(b)
        best = min((t for (i, _l), t in states.items() if i in bset), default=float("inf"))
        return f"{a_name} → {b_name}: {best:.1f}분" if math.isfinite(best) else f"{a_name} → {b_name}: 연결 없음"

    print("\n== 검증 (승강장 → 승강장, 환승/대기 포함; 출발지 = 승강장) ==")
    for a, b in [
        ("시청", "강남"),
        ("시청", "인천"),
        ("시청", "신도림"),
        ("시청", "동대문역사문화공원"),
        ("서울역", "인천공항1터미널"),
        ("시청", "사당"),
        ("시청", "판교(판교테크노밸리)"),
        ("시청", "광교(경기대)"),
        ("시청", "을지로3가"),
        ("시청", "동묘앞"),
        ("시청", "왕십리(성동구청)"),
    ]:
        print(" ", trip_minutes(a, b))

    # ------------------------------------------------------------------------- 순위 데이터
    stops_per_station = defaultdict(int)
    for tid, rows in per_trip.items():
        seen = set()
        for stop, _dep in rows:
            if stop not in seen:
                seen.add(stop)
        if len(seen) > 1:
            for stop in seen:
                stops_per_station[stops[stop]["name"]] += 1

    line_headway = []
    for key in line_order:
        per_stop_h = [statistics.median(hs) for hs in headways_by_line.get(key, {}).values() if hs]
        if per_stop_h:
            line_headway.append([LINE_NAMES.get(key, key), key, round(statistics.median(per_stop_h), 2), len(per_stop_h)])

    city = find_stops("시청")
    from_city = dijkstra(adj, nodes, {(i, -1): 0.0 for i in city}) if city else {}
    per_station_min = defaultdict(lambda: float("inf"))
    for (i, _line), t in from_city.items():
        sid = nodes[i]["s"]
        if t < per_station_min[sid]:
            per_station_min[sid] = t
    start_station = nodes[city[0]]["s"] if city else None
    far = sorted(
        ((stations[s]["n"], t) for s, t in per_station_min.items() if math.isfinite(t) and s != start_station),
        key=lambda kv: -kv[1],
    )[:12]
    within30 = sum(1 for s, t in per_station_min.items() if math.isfinite(t) and t <= 30.0 and s != start_station)

    longest_lines = []
    for key in line_order:
        best_chain = None
        for tid, rows in per_trip.items():
            if line_key_of(trips[tid][0]) != key:
                continue
            chain = []
            seen = set()
            for stop, _dep in rows:  # 순환선: 처음 재방문 시점에서 자른다 (한 바퀴 = 끝에서 끝)
                if stop in seen:
                    break
                chain.append(stop)
                seen.add(stop)
            if len(set(chain)) < 8:
                continue
            total = 0.0
            for a, b in zip(chain, chain[1:]):
                times = ride_samples.get(frozenset((a, b)))
                if times:
                    total += statistics.median(times)
            if best_chain is None or total > best_chain[0]:
                best_chain = (total, len(set(chain)))
        if best_chain:
            longest_lines.append([LINE_NAMES.get(key, key), key, round(best_chain[0], 1), best_chain[1]])

    rankings = {
        "generated": date.today().isoformat(),
        "note": "배차간격/정차 횟수는 KTDB GTFS의 단순화된 계획 시간표에서 추정한다(실제 열차 수가 아니며 역별·노선별 표본의 중앙값).",
        "lineHeadwayShort": sorted(line_headway, key=lambda row: row[2])[:12],
        "lineHeadwayLong": sorted(line_headway, key=lambda row: -row[2])[:12],
        "mostStops": sorted(stops_per_station.items(), key=lambda kv: -kv[1])[:14],
        "longestTrips": sorted(longest_lines, key=lambda row: -row[2])[:12],
        "farthestFromCityHall": [[n, t] for n, t in far],
        "reachableFromCityHall": {"within30": within30, "totalStations": len(per_station_min)},
    }
    out_rank = OUT / "rankings.json"
    out_rank.write_text(json.dumps(rankings, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"rankings.json {(out_rank.stat().st_size) / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
