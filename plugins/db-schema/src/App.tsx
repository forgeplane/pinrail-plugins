// The database schema review: the diagram on the left and the side panel
// on the right. The verdict follows from the comments, and the app's
// hand-over button says which it is. main.tsx connects to the app and draws
// this with each init.
import { Code, MessageSquare, PanelRightClose, PanelRightOpen, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Init, Plugin, Settings } from "../pinrail-plugin";
import { layoutOptions, type LayoutOptions } from "./layout";
import { Diagram, type Marks } from "./Diagram";
import { Panel, firstTab, type ComposeRequest, type PanelTab } from "./Panel";
import {
  keyOf,
  targetOf,
  verdictOf,
  type Answer,
  type Comment,
  type Decision,
  type Draft,
  type Payload,
  type Target,
  highlightSql,
} from "./types";

export type { Decision, Payload } from "./types";

const { Pinrail } = window;

/** What the connection in main.tsx asks of the view on screen. */
export const view = {
  /** the decision, or nothing while the person confirms unanswered questions */
  collect: (): Decision | undefined => undefined,
  /** the plugin's settings changed, in the app or through the view */
  settings: (_settings: Settings): void => undefined,
};

/** A draft kept by an earlier release may have another shape: use only what reads as this one's. */
function draftOf(kept: unknown): Draft {
  const d = (kept && typeof kept === "object" ? kept : {}) as Partial<Draft>;
  return {
    comments: Array.isArray(d.comments) ? d.comments : [],
    answers: Array.isArray(d.answers) ? d.answers : [],
    apply: d.apply === true,
  };
}

const answered = (a: Answer) => !!(a.choice || a.text?.trim());

/** The answers as the decision schema takes them: only those with something in them. */
const cleanAnswers = (answers: Answer[]): Answer[] =>
  answers.filter(answered).map((a) => ({
    id: a.id,
    ...(a.choice ? { choice: a.choice } : {}),
    ...(a.text?.trim() ? { text: a.text.trim() } : {}),
  }));

export function App({ plugin, init }: { plugin: Plugin<Payload, Decision>; init: Init<Payload, Decision> }) {
  const { review, readonly } = init;
  const payload = review.payload;
  const decided = review.decision?.data;

  const [draft, setDraft] = useState<Draft>(() =>
    readonly && decided
      ? { comments: decided.comments, answers: decided.answers, apply: decided.verdict === "approve" }
      : draftOf(init.draft),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ table: string; at: number } | null>(null);
  const [tab, setTab] = useState<"diagram" | "sql">("diagram");
  // the panel starts open beside the diagram, and closed as a drawer when
  // the view is narrow; selecting a part opens it either way
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia("(max-width: 760px)").matches);
  const [panelTab, setPanelTab] = useState<PanelTab>(() => firstTab(payload));
  const [compose, setCompose] = useState<ComposeRequest | null>(null);
  // a hand-over with questions unanswered asks first, in the confirmation bar
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  armedRef.current = armed;
  const [options, setOptions] = useState<LayoutOptions>(() => layoutOptions(init.settings ?? {}));
  // settings without a layout key, as from an app that does not know it,
  // leave that part of the layout as it is
  view.settings = (settings) => setOptions((o) => layoutOptions(settings, o));
  const setOption = useCallback(
    <K extends keyof LayoutOptions>(key: K, value: LayoutOptions[K]) => {
      setOptions((o) => ({ ...o, [key]: value }));
      // kept by the app, for every review of this plugin
      plugin.setSetting(key, value).catch(() => undefined);
    },
    [plugin],
  );
  const latest = useRef(draft);
  latest.current = draft;
  const panelRef = useRef<HTMLElement>(null);

  // the app's confirmation bar, under the diagram and the panel
  const barSlot = useRef<HTMLDivElement>(null);
  const bar = useMemo(() => Pinrail.confirmationBar(), []);
  useEffect(() => {
    barSlot.current?.replaceChildren(bar.element);
  }, [bar]);
  useEffect(() => {
    const left = (payload.questions ?? []).filter(
      (q) => !draft.answers.some((a) => a.id === q.id && answered(a)),
    ).length;
    if (!armed || !left) {
      bar.confirmation(null);
      return;
    }
    const answer = document.createElement("button");
    answer.type = "button";
    answer.className = "pinrail-btn";
    answer.textContent = left === 1 ? "Answer it" : "Answer them";
    answer.onclick = () => {
      setArmed(false);
      setPanelTab("questions");
      setPanelOpen(true);
    };
    bar.confirmation({
      text: `${left === 1 ? "1 question is" : `${left} questions are`} unanswered, so the agent will go with ${left === 1 ? "its proposal" : "its proposals"}. Hand over again to confirm.`,
      tone: "warning",
      actions: [answer],
    });
  }, [bar, armed, draft.answers, payload]);

  const change = useCallback(
    (f: (d: Draft) => Draft) => {
      const next = f(latest.current);
      latest.current = next;
      setDraft(next);
      setArmed(false);
      plugin.draft(next);
    },
    [plugin],
  );

  view.collect = () => {
    const d = latest.current;
    const answers = cleanAnswers(d.answers);
    const unanswered = (payload.questions ?? []).map((q) => q.id).filter((id) => !answers.some((a) => a.id === id));
    if (unanswered.length && !armedRef.current) {
      setArmed(true);
      return;
    }
    setArmed(false);
    return { verdict: verdictOf(d), comments: d.comments, answers, unanswered };
  };

  useEffect(() => {
    if (readonly) return;
    const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const changes = draft.comments.filter((c) => c.kind === "change").length;
    const questions = draft.comments.length - changes;
    const asked = questions ? count(questions, "question", "questions") : "";
    const label =
      verdictOf(draft) === "revise"
        ? `Request ${count(changes, "change", "changes")}${asked ? ` and ask ${asked}` : ""}`
        : changes
          ? `Approve with ${count(changes, "change", "changes")}${asked ? ` and ${asked}` : ""}`
          : `Approve${asked ? ` with ${asked}` : ""}`;
    const left = (payload.questions ?? []).filter(
      (q) => !draft.answers.some((x) => x.id === q.id && answered(x)),
    ).length;
    plugin.handOverLabel(armed && left ? `${label}, ${left} unanswered` : label);
  }, [plugin, readonly, draft, armed, payload]);

  const select = useCallback((target: Target | null) => {
    if (!target) return setSelected(null);
    const key = keyOf(target);
    setSelected(key);
    setPanelTab("part");
    setPanelOpen(true);
    panelRef.current?.scrollTo({ top: 0 });
  }, []);

  /** the table a part is drawn in: a relationship's is the referencing table */
  const tableOf = useCallback(
    (t: Target) =>
      "relationship" in t ? payload.relationships?.find((r) => r.id === t.relationship)?.from.table : t.table,
    [payload],
  );

  /** a click in the panel on a part: select it and bring it into view */
  const show = useCallback(
    (target: Target | null) => {
      select(target);
      if (target) {
        setTab("diagram");
        const table = tableOf(target);
        if (table) setFocus({ table, at: Date.now() });
      }
    },
    [select, tableOf],
  );

  const marks = useMemo<Marks>(() => {
    const m: Marks = new Map();
    const at = (key: string) => {
      if (!m.has(key)) m.set(key, { comments: 0, changes: 0, questions: 0 });
      return m.get(key)!;
    };
    for (const c of draft.comments) {
      if (!c.target) continue;
      const e = at(keyOf(c.target));
      e.comments++;
      if (c.kind === "change") e.changes++;
    }
    for (const q of payload.questions ?? []) if (q.about) at(keyOf(q.about)).questions++;
    return m;
  }, [draft.comments, payload]);

  const edit = useMemo(
    () => ({
      add(target: Target | undefined, kind: Comment["kind"], text: string) {
        change((d) => {
          const n = Math.max(0, ...d.comments.map((c) => Number(c.id.replace(/^c/, "")) || 0)) + 1;
          return { ...d, comments: [...d.comments, { id: `c${n}`, ...(target ? { target } : {}), kind, text }] };
        });
      },
      update(id: string, kind: Comment["kind"], text: string) {
        change((d) => ({ ...d, comments: d.comments.map((c) => (c.id === id ? { ...c, kind, text } : c)) }));
      },
      remove(id: string) {
        change((d) => ({ ...d, comments: d.comments.filter((c) => c.id !== id) }));
      },
      apply(apply: boolean) {
        change((d) => ({ ...d, apply }));
      },
      answer(answer: Answer) {
        change((d) => ({ ...d, answers: [...d.answers.filter((a) => a.id !== answer.id), answer] }));
      },
    }),
    [change],
  );

  // n and p move through the tables, and c and q start a comment on the
  // selected part, or on the whole schema: the keys the manifest declares
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT") && !e.pinrailForwarded) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === "c" || e.key === "q") && !readonly) {
        e.preventDefault();
        setPanelTab(selected ? "part" : "about");
        setPanelOpen(true);
        setCompose({ kind: e.key === "c" ? "change" : "question", at: Date.now() });
        return;
      }
      if (e.key !== "n" && e.key !== "p") return;
      const names = payload.tables.map((t) => t.name);
      const name = selected ? tableOf(targetOf(selected)) : undefined;
      const i = name ? names.indexOf(name) : -1;
      const step = e.key === "n" ? 1 : -1;
      const next = i < 0 ? (step > 0 ? 0 : names.length - 1) : (i + step + names.length) % names.length;
      show({ table: names[next] });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [payload, selected, show, tableOf, readonly]);

  const counts = {
    added: payload.tables.filter((t) => t.change === "added").length,
    changed: payload.tables.filter((t) => t.change === "changed" || (!t.change && t.columns.some((c) => c.change)))
      .length,
    removed: payload.tables.filter((t) => t.change === "removed").length,
  };

  return (
    <div className={`dbs${panelOpen ? " dbs-panel-open" : ""}`}>
      <header className="dbs-bar">
        <div className="dbs-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className="pinrail-btn pinrail-btn-ghost"
            aria-selected={tab === "diagram"}
            aria-pressed={tab === "diagram"}
            onClick={() => setTab("diagram")}
          >
            <Workflow />
            Diagram
          </button>
          {payload.sql && (
            <button
              type="button"
              role="tab"
              className="pinrail-btn pinrail-btn-ghost"
              aria-selected={tab === "sql"}
              aria-pressed={tab === "sql"}
              onClick={() => setTab("sql")}
            >
              <Code />
              SQL
            </button>
          )}
        </div>
        <span className="dbs-meta pinrail-dim">
          {payload.tables.length} {payload.tables.length === 1 ? "table" : "tables"}
          {counts.added > 0 && <span className="erd-change erd-change-added">{counts.added} new</span>}
          {counts.changed > 0 && <span className="erd-change erd-change-changed">{counts.changed} changed</span>}
          {counts.removed > 0 && <span className="erd-change erd-change-removed">{counts.removed} removed</span>}
        </span>
        <span className="dbs-spacer" />
        {readonly &&
          (decided ? (
            <span className={`pinrail-chip pinrail-tone-${decided.verdict === "approve" ? "success" : "warning"}`}>
              {decided.verdict === "approve" ? "Approved" : "Changes requested"}
            </span>
          ) : (
            <span className="pinrail-dim">Closed without a decision ({review.status})</span>
          ))}
        <button
          type="button"
          className="pinrail-btn pinrail-btn-ghost dbs-panel-toggle"
          onClick={() => setPanelOpen((o) => !o)}
          aria-label={panelOpen ? "Hide the side panel" : "Show the side panel"}
          title={panelOpen ? "Hide the side panel" : "Show the side panel"}
          aria-expanded={panelOpen}
        >
          {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
          {draft.comments.length > 0 && (
            <span className="dbs-count">
              <MessageSquare />
              {draft.comments.length}
            </span>
          )}
        </button>
      </header>
      <div className="dbs-body">
        <div className="dbs-main">
          {tab === "diagram" ? (
            <Diagram
              payload={payload}
              selected={selected}
              marks={marks}
              select={select}
              focus={focus}
              options={options}
              setOption={setOption}
            />
          ) : (
            <pre className="dbs-sql">
              <code dangerouslySetInnerHTML={{ __html: highlightSql(payload.sql ?? "") }} />
            </pre>
          )}
        </div>
        <div className="dbs-scrim" onClick={() => setPanelOpen(false)} />
        <aside className="dbs-panel" ref={panelRef} aria-label="Comments and questions">
          <Panel
            payload={payload}
            readonly={readonly}
            selected={selected ? targetOf(selected) : null}
            comments={draft.comments}
            answers={draft.answers}
            apply={draft.apply}
            compose={compose}
            edit={edit}
            select={show}
            tab={panelTab}
            setTab={setPanelTab}
            close={() => setPanelOpen(false)}
          />
        </aside>
      </div>
      <div ref={barSlot} />
    </div>
  );
}
