// The diagram's controls, at its bottom left: zoom, fit, a toggle for the
// layout's direction, and its ranking, chosen from a menu.
import { Panel, useReactFlow } from "@xyflow/react";
import { ArrowDown, ArrowRight, Check, ListTree, Maximize, Minus, Network, Plus, Waypoints } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LayoutOptions } from "./layout";

type Choice<V> = { value: V; label: string; detail: string; icon: React.ReactNode };

/** The button shows the current direction, and a press turns to the other. */
const DIRECTIONS: Omit<Choice<LayoutOptions["direction"]>, "detail">[] = [
  { value: "left-to-right", label: "Left to right", icon: <ArrowRight /> },
  { value: "top-to-bottom", label: "Top to bottom", icon: <ArrowDown /> },
];

const RANKINGS: Choice<LayoutOptions["ranking"]>[] = [
  { value: "network-simplex", label: "Balanced", detail: "Short lines, evenly spaced", icon: <Network /> },
  { value: "tight-tree", label: "Tight tree", detail: "Compact, with longer lines", icon: <ListTree /> },
  { value: "longest-path", label: "Longest path", detail: "Each table as far along as it can go", icon: <Waypoints /> },
];

type Props = {
  options: LayoutOptions;
  setOption<K extends keyof LayoutOptions>(key: K, value: LayoutOptions[K]): void;
};

function Menu<V extends string>({
  label,
  choices,
  value,
  pick,
}: {
  label: string;
  choices: Choice<V>[];
  value: V;
  pick(value: V): void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div className="erd-menu" role="menu" aria-label={label}>
      <div className="erd-menu-title">{label}</div>
      {choices.map((c, i) => (
        <button
          key={c.value}
          ref={i === 0 ? first : undefined}
          type="button"
          role="menuitemradio"
          aria-checked={c.value === value}
          className="erd-menu-item"
          onClick={() => pick(c.value)}
        >
          <span className="erd-menu-icon">{c.icon}</span>
          <span className="erd-menu-text">
            <span>{c.label}</span>
            <span className="erd-menu-detail">{c.detail}</span>
          </span>
          <span className="erd-menu-check">{c.value === value && <Check />}</span>
        </button>
      ))}
    </div>
  );
}

export function CanvasControls({ options, setOption }: Props) {
  const flow = useReactFlow();
  const [open, setOpen] = useState<"ranking" | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // a click beside the menu, or Esc, closes it
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const direction = DIRECTIONS.find((d) => d.value === options.direction)!;
  const other = DIRECTIONS.find((d) => d.value !== options.direction)!;
  const ranking = RANKINGS.find((r) => r.value === options.ranking)!;
  const toggle = (menu: "ranking") => setOpen((o) => (o === menu ? null : menu));

  return (
    <Panel position="bottom-left" className="erd-controls-panel">
      <div ref={box} className="erd-controls-box">
        <div className="erd-controls">
          <button
            type="button"
            className="erd-control"
            onClick={() => flow.zoomIn({ duration: 200 })}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <Plus />
          </button>
          <button
            type="button"
            className="erd-control"
            onClick={() => flow.zoomOut({ duration: 200 })}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <Minus />
          </button>
          <button
            type="button"
            className="erd-control"
            onClick={() => flow.fitView({ duration: 300, padding: 0.1 })}
            title="Fit the diagram (F)"
            aria-label="Fit the diagram"
          >
            <Maximize />
          </button>
        </div>
        <div className="erd-controls">
          <button
            type="button"
            className="erd-control"
            onClick={() => setOption("direction", other.value)}
            title={`${direction.label}: switch to ${other.label.toLowerCase()}`}
            aria-label={`Diagram direction: ${direction.label}`}
          >
            {direction.icon}
          </button>
          <button
            type="button"
            className="erd-control"
            onClick={() => toggle("ranking")}
            title={`Layout: ${ranking.label}`}
            aria-label={`Diagram layout: ${ranking.label}`}
            aria-haspopup="menu"
            aria-expanded={open === "ranking"}
          >
            {ranking.icon}
          </button>
        </div>
        {open === "ranking" && (
          <Menu
            label="Layout"
            choices={RANKINGS}
            value={options.ranking}
            pick={(v) => (setOption("ranking", v), setOpen(null))}
          />
        )}
      </div>
    </Panel>
  );
}
