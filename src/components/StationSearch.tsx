/** 역 검색 콤보박스: Popover + Command(shadcn). 한글 부분일치 + "경도, 위도" 좌표 입력. */
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseCoords, searchStations } from "@/lib/search.ts";
import type { NetworkData, Place, RawStation } from "@/lib/types.ts";
import { cn } from "cn";

interface Props {
  label: string;
  placeholder: string;
  data: NetworkData;
  value: Place | null;
  onPick: (place: Place) => void;
}

export function StationSearch({ label, placeholder, data, value, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const stations: RawStation[] = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const coords = parseCoords(data, q);
    if (coords) return [{ n: `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`, lon: coords[0], lat: coords[1] }];
    return searchStations(data.stations, q, 12);
  }, [data, query]);

  const pick = (s: RawStation) => {
    onPick({ label: s.n, point: [s.lon, s.lat] });
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger
          render={
            <Button variant="outline" role="combobox" className="w-full justify-between px-3 font-normal">
              <span className="truncate">{value?.label ?? placeholder}</span>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
            </Button>
          }
        />
        <PopoverContent className="w-[19.5rem] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="역 이름 또는 127.0, 37.5"
              value={query}
              autoFocus
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
              {stations.map((s) => (
                <CommandItem
                  key={`${s.n}-${s.lon}-${s.lat}`}
                  value={`${s.n}-${s.lon}-${s.lat}`}
                  onSelect={() => pick(s)}
                >
                  <Check className={cn("size-3.5", value?.label === s.n ? "opacity-100" : "opacity-0")} />
                  {s.n}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
