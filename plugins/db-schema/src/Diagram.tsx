// The diagram: a card per table, with a row per column, and a line per
// relationship from the foreign key's row to the row it references. A click
// on a table's head, a column or a line selects that part.
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  getSmoothStepPath,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { KeyRound, Link2, MessageSquare, CircleHelp } from "lucide-react";
import { createContext, memo, useContext, useEffect, useMemo, useRef } from "react";
import { CanvasControls } from "./Controls";
import { layout, ROW, type LayoutOptions } from "./layout";
import { keyOf, type Change, type Payload, type Relationship, type Table, type Target } from "./types";

/** What a part carries on the diagram: its comments, and the agent's questions about it. */
export type Marks = Map<string, { comments: number; changes: number; questions: number }>;

type Shared = {
  selected: string | null;
  marks: Marks;
  select(target: Target): void;
  /** the columns of each table that a relationship starts from */
  foreign: Map<string, Set<string>>;
};

const SharedContext = createContext<Shared>(null!);

type TableData = { table: Table };
type TableNodeType = Node<TableData, "table">;
type RelationData = { rel: Relationship; nullable: boolean };
type RelationEdgeType = Edge<RelationData, "relation">;

function Mark({ mark }: { mark?: { comments: number; changes: number; questions: number } }) {
  if (!mark || (!mark.comments && !mark.questions)) return null;
  return (
    <span className="erd-marks">
      {mark.questions > 0 && (
        <span className="erd-mark erd-mark-question" title={`${mark.questions} question from the agent`}>
          <CircleHelp />
        </span>
      )}
      {mark.comments > 0 && (
        <span
          className={`erd-mark ${mark.changes ? "erd-mark-change" : "erd-mark-comment"}`}
          title={`${mark.comments} ${mark.comments === 1 ? "comment" : "comments"}`}
        >
          <MessageSquare />
          {mark.comments}
        </span>
      )}
    </span>
  );
}

const changeLabel: Record<Change, string> = { added: "new", removed: "removed", changed: "changed" };

function ChangeChip({ change }: { change?: Change }) {
  if (!change) return null;
  return <span className={`erd-change erd-change-${change}`}>{changeLabel[change]}</span>;
}

const TableNode = memo(function TableNode({ data }: NodeProps<TableNodeType>) {
  const { selected, marks, select, foreign } = useContext(SharedContext);
  const { table } = data;
  const tableKey = keyOf({ table: table.name });
  const fks = foreign.get(table.name);
  return (
    <div
      className={`erd-table${table.change ? ` erd-${table.change}` : ""}${selected === tableKey ? " erd-selected" : ""}`}
      data-table={table.name}
    >
      <button
        type="button"
        className="erd-head"
        onClick={() => select({ table: table.name })}
        aria-label={`Table ${table.name}`}
        aria-pressed={selected === tableKey}
      >
        <span className="erd-name">{table.name}</span>
        {table.was?.name && <span className="erd-was">was {table.was.name}</span>}
        <ChangeChip change={table.change} />
        <Mark mark={marks.get(tableKey)} />
      </button>
      {table.columns.map((c) => {
        const key = keyOf({ table: table.name, column: c.name });
        const typeChanged = c.was?.type !== undefined && c.was.type !== c.type;
        return (
          <button
            type="button"
            key={c.name}
            className={`erd-row${c.change ? ` erd-${c.change}` : ""}${selected === key ? " erd-selected" : ""}`}
            onClick={() => select({ table: table.name, column: c.name })}
            aria-label={`Column ${table.name}.${c.name}`}
            aria-pressed={selected === key}
            style={{ height: ROW }}
          >
            <span className="erd-icon">
              {c.primary_key ? (
                <KeyRound className="erd-pk" aria-label="primary key" />
              ) : fks?.has(c.name) ? (
                <Link2 className="erd-fk" aria-label="foreign key" />
              ) : null}
            </span>
            <span className="erd-col">
              {c.was?.name && c.was.name !== c.name && <s className="erd-old">{c.was.name}</s>}
              {c.name}
            </span>
            <Mark mark={marks.get(key)} />
            <span className="erd-type">
              {typeChanged && <s className="erd-old">{c.was!.type}</s>}
              {c.type}
              {c.nullable ? (
                <span className="erd-null" title="takes NULL">
                  ?
                </span>
              ) : null}
              {c.unique && !c.primary_key ? (
                <span className="erd-unique" title="unique">
                  U
                </span>
              ) : null}
            </span>
            <Handle id={`${c.name}:sl`} type="source" position={Position.Left} className="erd-handle" />
            <Handle id={`${c.name}:sr`} type="source" position={Position.Right} className="erd-handle" />
            <Handle id={`${c.name}:tl`} type="target" position={Position.Left} className="erd-handle" />
            <Handle id={`${c.name}:tr`} type="target" position={Position.Right} className="erd-handle" />
          </button>
        );
      })}
      {table.indexes?.length ? (
        <button type="button" className="erd-foot" onClick={() => select({ table: table.name })}>
          {table.indexes.length} {table.indexes.length === 1 ? "index" : "indexes"}
          {table.indexes.some((i) => i.change) && <span className="erd-foot-change"> · changed</span>}
        </button>
      ) : null}
    </div>
  );
});

/** The end of a line, in crow's foot notation: how many rows on that side. */
type Shape = "one" | "zero-one" | "zero-many";
const TONES = ["base", "selected", "added", "removed"] as const;
type Tone = (typeof TONES)[number];

function Markers() {
  // drawn for the line's end, with the table at +x: auto-start-reverse turns
  // the same marker round for the line's start
  const shapes: Record<Shape, React.ReactNode> = {
    one: (
      <>
        <path d="M-5,-6 V6 M-10,-6 V6 M-16,0 H0" />
      </>
    ),
    "zero-one": (
      <>
        <path d="M-5,-6 V6 M-10,0 H0" />
        <circle cx="-14" cy="0" r="3.5" />
      </>
    ),
    "zero-many": (
      <>
        <path d="M-11,0 L0,-6 M-11,0 L0,6 M-11,0 H0" />
        <circle cx="-15" cy="0" r="3.5" />
      </>
    ),
  };
  return (
    <svg className="erd-defs" aria-hidden="true">
      <defs>
        {TONES.flatMap((tone) =>
          (Object.keys(shapes) as Shape[]).map((shape) => (
            <marker
              key={`${shape}-${tone}`}
              id={`erd-${shape}-${tone}`}
              className={`erd-marker erd-marker-${tone}`}
              viewBox="-20 -10 21 20"
              refX="0"
              refY="0"
              markerWidth="21"
              markerHeight="20"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              {shapes[shape]}
            </marker>
          )),
        )}
      </defs>
    </svg>
  );
}

function RelationEdge(props: EdgeProps<RelationEdgeType>) {
  const { selected, marks, select } = useContext(SharedContext);
  const { rel, nullable } = props.data!;
  const key = keyOf({ relationship: rel.id });
  const isSelected = selected === key;
  const [path, labelX, labelY] = getSmoothStepPath({ ...props, borderRadius: 10, offset: 28 });
  const tone: Tone = isSelected
    ? "selected"
    : rel.change === "added"
      ? "added"
      : rel.change === "removed"
        ? "removed"
        : "base";
  const fromShape: Shape = rel.cardinality === "one-to-one" ? "zero-one" : "zero-many";
  const toShape: Shape = nullable ? "zero-one" : "one";
  const mark = marks.get(key);
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        className={`erd-edge erd-edge-${tone}`}
        markerStart={`url(#erd-${fromShape}-${tone})`}
        markerEnd={`url(#erd-${toShape}-${tone})`}
        interactionWidth={18}
      />
      {(isSelected || mark?.comments || mark?.questions) && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className={`erd-edge-label nodrag nopan${isSelected ? " erd-selected" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onClick={() => select({ relationship: rel.id })}
          >
            {isSelected && <span>{rel.on_delete ? `on delete ${rel.on_delete}` : rel.id}</span>}
            <Mark mark={mark} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { table: TableNode };
const edgeTypes = { relation: RelationEdge };

type Props = {
  payload: Payload;
  selected: string | null;
  marks: Marks;
  select(target: Target | null): void;
  /** the part to bring into view, when it changes */
  focus: { table: string; at: number } | null;
  options: LayoutOptions;
  setOption<K extends keyof LayoutOptions>(key: K, value: LayoutOptions[K]): void;
};

const placeTables = (payload: Payload, options: LayoutOptions): TableNodeType[] => {
  const placed = layout(payload, options);
  return payload.tables.map((table) => {
    const p = placed.get(table.name)!;
    return {
      id: table.name,
      type: "table",
      position: { x: p.x, y: p.y },
      width: p.width,
      height: p.height,
      style: { width: p.width },
      data: { table },
    };
  });
};

function Canvas({ payload, selected, marks, select, focus, options, setOption }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeType>(placeTables(payload, options));
  const flow = useReactFlow();

  // another layout places every table again, dragged ones too
  const laidOut = useRef(options);
  useEffect(() => {
    if (laidOut.current.direction === options.direction && laidOut.current.ranking === options.ranking) return;
    laidOut.current = options;
    setNodes(placeTables(payload, options));
    // fit once React Flow has placed the moved tables
    setTimeout(() => flow.fitView({ duration: 300, padding: 0.1, maxZoom: 1 }), 50);
  }, [options, payload, setNodes, flow]);

  const foreign = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const r of payload.relationships ?? []) {
      const set = map.get(r.from.table) ?? new Set();
      r.from.columns.forEach((c) => set.add(c));
      map.set(r.from.table, set);
    }
    return map;
  }, [payload]);

  // each line leaves and enters on the sides that face each other, which
  // change as tables are dragged
  const edges = useMemo<RelationEdgeType[]>(() => {
    const at = new Map(nodes.map((n) => [n.id, n]));
    return (payload.relationships ?? []).flatMap((rel) => {
      const from = at.get(rel.from.table);
      const to = at.get(rel.to.table);
      if (!from || !to) return [];
      const fromTable = payload.tables.find((t) => t.name === rel.from.table)!;
      const nullable = rel.from.columns.some((c) => fromTable.columns.find((col) => col.name === c)?.nullable);
      const centre = (n: TableNodeType) => n.position.x + (n.width ?? 0) / 2;
      const gap = Math.abs(centre(from) - centre(to));
      // tables stacked one above the other: the line runs down their right sides
      const stacked = gap < ((from.width ?? 0) + (to.width ?? 0)) / 4;
      const rightward = centre(from) < centre(to);
      const [fromSide, toSide] = from.id === to.id || stacked ? ["r", "r"] : rightward ? ["r", "l"] : ["l", "r"];
      return [
        {
          id: rel.id,
          type: "relation",
          source: rel.from.table,
          target: rel.to.table,
          sourceHandle: `${rel.from.columns[0]}:s${fromSide}`,
          targetHandle: `${rel.to.columns[0]}:t${toSide}`,
          data: { rel, nullable: !!nullable },
          zIndex: selected === keyOf({ relationship: rel.id }) ? 10 : 0,
        },
      ];
    });
  }, [nodes, payload, selected]);

  useEffect(() => {
    if (!focus) return;
    const node = nodes.find((n) => n.id === focus.table);
    if (!node) return;
    flow.fitView({ nodes: [{ id: node.id }], duration: 300, maxZoom: Math.max(flow.getZoom(), 0.9), padding: 0.6 });
    // only a new focus moves the view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // the keys the manifest declares, also forwarded from the app
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT") && !e.pinrailForwarded) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "f") flow.fitView({ duration: 300, padding: 0.1 });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flow]);

  const shared = useMemo<Shared>(() => ({ selected, marks, select, foreign }), [selected, marks, select, foreign]);

  return (
    <SharedContext.Provider value={shared}>
      <Markers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgeClick={(_, edge) => select({ relationship: edge.id })}
        onPaneClick={() => select(null)}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <CanvasControls options={options} setOption={setOption} />
      </ReactFlow>
    </SharedContext.Provider>
  );
}

export function Diagram(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
