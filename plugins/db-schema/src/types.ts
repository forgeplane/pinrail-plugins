// The payload and the decision, as schemas/ describes them.

export type Change = "added" | "removed" | "changed";
export type Action = "cascade" | "restrict" | "set null" | "set default" | "no action";

export type Column = {
  name: string;
  type: string;
  nullable?: boolean;
  default?: string;
  primary_key?: boolean;
  unique?: boolean;
  note?: string;
  change?: Change;
  was?: { name?: string; type?: string; nullable?: boolean; default?: string | null };
};

export type Index = {
  name?: string;
  columns: string[];
  include?: string[];
  using?: string;
  unique?: boolean;
  where?: string;
  note?: string;
  change?: Change;
};

export type Table = {
  name: string;
  note?: string;
  change?: Change;
  was?: { name?: string };
  columns: Column[];
  indexes?: Index[];
};

export type End = { table: string; columns: string[] };

export type Relationship = {
  id: string;
  from: End;
  to: End;
  cardinality?: "many-to-one" | "one-to-one";
  on_delete?: Action;
  on_update?: Action;
  note?: string;
  change?: Change;
};

/** a table, one of its columns, or a relationship */
export type Target = { table: string; column?: string } | { relationship: string };

export type Question = {
  id: string;
  text: string;
  about?: Target;
  options?: string[];
  proposal: string;
};

/** the agent's reply to a comment of the round this one revises */
export type Reply = { id: string; text: string };

export type Payload = {
  summary?: string;
  replies?: Reply[];
  dialect?: string;
  tables: Table[];
  relationships?: Relationship[];
  questions?: Question[];
  sql?: string;
};

export type CommentKind = "change" | "question";
/** a comment without a target is about the whole schema */
export type Comment = { id: string; target?: Target; kind: CommentKind; text: string };
export type Answer = { id: string; choice?: string; text?: string };
export type Verdict = "approve" | "revise";

export type Decision = {
  verdict: Verdict;
  comments: Comment[];
  answers: Answer[];
  unanswered: string[];
};

/** what is kept between reloads: the decision so far */
export type Draft = {
  comments: Comment[];
  answers: Answer[];
  /** with comments: approve with their changes, rather than ask for another version */
  apply: boolean;
};

/** The verdict follows from the comments: a change asks for a new version,
 *  unless the person chose to have the changes applied directly. Questions
 *  alone approve, and the agent answers them before it applies the schema. */
export const verdictOf = (d: Pick<Draft, "comments" | "apply">): Verdict =>
  d.comments.some((c) => c.kind === "change") && !d.apply ? "revise" : "approve";

/** One string per part, to compare and select by. A table's name can hold
 *  a dot, so a unit separator divides it from the column's. */
export const keyOf = (t: Target): string =>
  "relationship" in t ? `r:${t.relationship}` : t.column ? `c:${t.table}\u001f${t.column}` : `t:${t.table}`;

export function targetOf(key: string): Target {
  if (key.startsWith("r:")) return { relationship: key.slice(2) };
  const [table, column] = key.slice(2).split("\u001f");
  return column === undefined ? { table } : { table, column };
}

/** How the part reads in the panel: orders, orders.total, or the relationship's id. */
export const labelOf = (t: Target): string =>
  "relationship" in t ? t.relationship : t.column ? `${t.table}.${t.column}` : t.table;

/** SQL as highlighted HTML, or escaped as it is where the SDK has no
 *  highlighter, as before its 1.1 release. */
export const highlightSql = (code: string): string =>
  typeof window.Pinrail.highlight === "function" ? window.Pinrail.highlight(code, "sql") : window.Pinrail.escape(code);
