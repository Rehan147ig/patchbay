"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@patchbay/ui";
import { cn } from "@patchbay/ui";

export interface RadarNode {
  id: string;
  filePath: string;
  symbol: string;
  usageType: string;
  riskTags: string[];
  vendorSlug: string;
}

export interface BlastRadarData {
  packageName: string;
  version: string;
  affected: RadarNode[];
  colocated: RadarNode[];
}

interface PlacedNode extends RadarNode {
  x: number;
  y: number;
  ring: 1 | 2;
  radius: number;
  color: string;
}

const RING_1_COLOR = "#f87171";
const RING_2_COLOR = "#fbbf24";
const CENTER_COLOR = "#60a5fa";
const EDGE_COLOR = "rgba(124, 132, 143, 0.35)";

/**
 * Bounded 2-hop blast-radius radar. Deterministic radial layout rendered on
 * canvas (no physics, no animation loop): the changed package sits at the
 * center, affected usages (strict exact-symbol matches) form ring 1, and
 * co-located usages in the same files form ring 2. Click a node for evidence.
 * Capped at ~150 nodes so it stays instant on large snapshots.
 */
export function BlastRadar({ data }: { data: BlastRadarData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [size, setSize] = useState(320);

  const placed: PlacedNode[] = useMemo(() => {
    const nodes: PlacedNode[] = [];
    const ring1 = data.affected;
    const ring2 = data.colocated;
    const spread = (list: RadarNode[], ring: 1 | 2, radiusFrac: number, color: string) => {
      const count = list.length;
      list.forEach((node, index) => {
        const angle = count === 0 ? 0 : (2 * Math.PI * index) / count - Math.PI / 2;
        nodes.push({
          ...node,
          x: 0.5 + radiusFrac * Math.cos(angle),
          y: 0.5 + radiusFrac * Math.sin(angle),
          ring,
          radius: ring === 1 ? 7 : 4.5,
          color,
        });
      });
    };
    spread(ring1, 1, 0.26, RING_1_COLOR);
    spread(ring2, 2, 0.44, RING_2_COLOR);
    return nodes;
  }, [data]);

  const selected = useMemo(
    () => placed.find((node) => node.id === selectedId) ?? null,
    [placed, selectedId],
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observe = () => setSize(Math.max(260, Math.min(420, wrap.clientWidth)));
    observe();
    const observer = new ResizeObserver(observe);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    ctx.strokeStyle = "rgba(124, 132, 143, 0.18)";
    ctx.lineWidth = 1;
    for (const frac of [0.26, 0.44]) {
      ctx.beginPath();
      ctx.arc(cx, cy, frac * size, 0, 2 * Math.PI);
      ctx.stroke();
    }

    for (const node of placed) {
      ctx.strokeStyle = EDGE_COLOR;
      ctx.lineWidth = node.ring === 1 ? 1.2 : 0.7;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(node.x * size, node.y * size);
      ctx.stroke();
    }

    ctx.fillStyle = CENTER_COLOR;
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = "#08090b";
    ctx.font = "700 11px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Δ", cx, cy + 0.5);

    for (const node of placed) {
      const x = node.x * size;
      const y = node.y * size;
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(x, y, node.radius, 0, 2 * Math.PI);
      ctx.fill();
      if (node.id === selectedId) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, node.radius + 3.5, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  }, [placed, selectedId, size]);

  function onClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    let best: PlacedNode | null = null;
    let bestDist = 16;
    for (const node of placed) {
      const dx = node.x * rect.width - px;
      const dy = node.y * rect.height - py;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = node;
      }
    }
    setSelectedId(best ? best.id : null);
  }

  if (data.affected.length === 0) {
    return (
      <p className="text-sm text-ink-400">
        No affected usages on the latest plan — the radar appears once impact analysis finds
        exact-symbol matches.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ background: CENTER_COLOR }}
            aria-hidden="true"
          />
          {data.packageName}@{data.version}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ background: RING_1_COLOR }}
            aria-hidden="true"
          />
          {data.affected.length} affected
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ background: RING_2_COLOR }}
            aria-hidden="true"
          />
          {data.colocated.length} co-located
        </span>
      </div>
      <div ref={wrapRef} className="flex justify-center">
        <canvas
          ref={canvasRef}
          style={{ width: size, height: size }}
          onClick={onClick}
          role="img"
          aria-label={`Blast radar for ${data.packageName}: ${data.affected.length} affected usages, ${data.colocated.length} co-located`}
          className="cursor-pointer"
        />
      </div>
      {selected ? (
        <div className="rounded-lg border border-ink-700/60 bg-ink-900/60 p-3">
          <p className="font-mono text-xs text-gray-100">{selected.symbol}</p>
          <p className="mt-0.5 font-mono text-[11px] text-ink-400">{selected.filePath}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral" variant="subtle" size="sm">
              {selected.usageType}
            </Badge>
            <Badge tone="neutral" variant="outline" size="sm">
              {selected.vendorSlug}
            </Badge>
            {selected.riskTags.map((tag) => (
              <Badge key={tag} tone="amber" variant="subtle" size="sm">
                {tag}
              </Badge>
            ))}
            <Badge tone={selected.ring === 1 ? "red" : "blue"} variant="subtle" size="sm">
              {selected.ring === 1 ? "ring 1 · affected" : "ring 2 · co-located"}
            </Badge>
          </div>
        </div>
      ) : (
        <p className="text-center text-[11px] text-ink-500">Click a node for file evidence.</p>
      )}
      <div className={cn("sr-only")}>Blast radar data ends.</div>
    </div>
  );
}
