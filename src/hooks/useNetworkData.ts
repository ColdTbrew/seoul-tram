/** network.json/rankings.json을 fetch해 GraphModel로 준비한다. BASE_URL 상대경로 (Pages 하위경로 대응). */
import { useEffect, useState } from "react";
import { prepareNetwork } from "@/lib/graph.ts";
import type { GraphModel, NetworkData, RankingsData } from "@/lib/types.ts";

function dataUrl(file: string): string {
  return `${import.meta.env.BASE_URL}data/${file}`;
}

export interface NetworkState {
  model: GraphModel | null;
  error: string | null;
}

/** StrictMode 이중 마운트/재탐색 대비 모듈 캐시 (동일 파일 재다운로드 방지). */
let networkPromise: Promise<NetworkData> | null = null;

export function useNetworkData(): NetworkState {
  const [state, setState] = useState<NetworkState>({ model: null, error: null });

  useEffect(() => {
    let cancelled = false;
    networkPromise ??= fetch(dataUrl("network.json"), { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<NetworkData>;
    });
    networkPromise
      .then((data) => {
        if (!cancelled) setState({ model: prepareNetwork(data), error: null });
      })
      .catch((err: Error) => {
        if (!cancelled) {
          networkPromise = null; // 실패 시 재시도 허용
          setState({ model: null, error: err.message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export type RankingsState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: RankingsData };

export function useRankings(): RankingsState {
  const [state, setState] = useState<RankingsState>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl("rankings.json"), { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<RankingsData>;
      })
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ kind: "error", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
