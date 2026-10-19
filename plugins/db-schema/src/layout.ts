// Where each table goes on the canvas, and how big it is. Tables are laid
// out in ranks, left to right or top to bottom as the settings say, a
// referenced table before the tables that refer to it.
import dagre from "@dagrejs/dagre";
import type { Payload, Table } from "./types";

export const HEADER = 36;
export const ROW = 24;
export const FOOTER = 24;

/** The card's width, from its longest name and type, so that dagre and
 *  the card agree on it without measuring. */
export function widthOf(table: Table): number {
  const name = Math.max(table.name.length * 7.6 + 70, ...table.columns.map((c) => c.name.length * 7.2));
  const type = Math.max(
    0,
    ...table.columns.map((c) => (c.type.length + (c.was?.type ? c.was.type.length + 3 : 0)) * 6.6),
  );
  return Math.round(Math.min(420, Math.max(200, name + type + 64)));
}

export function heightOf(table: Table): number {
  return HEADER + table.columns.length * ROW + (table.indexes?.length ? FOOTER : 0) + 2;
}

export type Placed = { x: number; y: number; width: number; height: number };

/** The layout's settings, as the manifest's settings_schema declares them. */
export type LayoutOptions = {
  direction: "left-to-right" | "top-to-bottom";
  ranking: "network-simplex" | "tight-tree" | "longest-path";
};

export const DEFAULT_LAYOUT: LayoutOptions = { direction: "left-to-right", ranking: "network-simplex" };

/** The layout the settings give, over `base` for any key they leave out
 *  or hold a value this release does not know. */
export function layoutOptions(settings: Record<string, unknown>, base: LayoutOptions = DEFAULT_LAYOUT): LayoutOptions {
  const { direction, ranking } = settings;
  return {
    direction: direction === "left-to-right" || direction === "top-to-bottom" ? direction : base.direction,
    ranking:
      ranking === "network-simplex" || ranking === "tight-tree" || ranking === "longest-path" ? ranking : base.ranking,
  };
}

export function layout(payload: Payload, options: LayoutOptions = DEFAULT_LAYOUT): Map<string, Placed> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  const across = options.direction === "left-to-right";
  g.setGraph({
    rankdir: across ? "LR" : "TB",
    ranker: options.ranking,
    nodesep: across ? 36 : 60,
    ranksep: across ? 110 : 70,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of payload.tables) g.setNode(t.name, { width: widthOf(t), height: heightOf(t) });
  for (const r of payload.relationships ?? []) {
    if (r.from.table === r.to.table || !g.hasNode(r.from.table) || !g.hasNode(r.to.table)) continue;
    g.setEdge(r.to.table, r.from.table, {}, r.id);
  }
  dagre.layout(g);
  const placed = new Map<string, Placed>();
  for (const name of g.nodes()) {
    const n = g.node(name);
    placed.set(name, { x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height });
  }
  return placed;
}
