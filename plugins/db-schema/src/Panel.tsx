// The side panel: the selected part with its comments, then the agent's
// summary, its questions, and every comment so far.
import { ArrowUp, Check, CircleHelp, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  keyOf,
  labelOf,
  type Answer,
  type Comment,
  type CommentKind,
  type Payload,
  type Question,
  type Relationship,
  type Table,
  type Target,
  highlightSql,
} from "./types";

const { Pinrail } = window;

function Md({ text, inline }: { text: string; inline?: boolean }) {
  return inline ? (
    <span dangerouslySetInnerHTML={{ __html: Pinrail.markdownInline(text) }} />
  ) : (
    <div className="dbs-md" dangerouslySetInnerHTML={{ __html: Pinrail.markdown(text) }} />
  );
}

type Edit = {
  /** without a target, a comment on the whole schema */
  add(target: Target | undefined, kind: CommentKind, text: string): void;
  update(id: string, kind: CommentKind, text: string): void;
  remove(id: string): void;
  answer(answer: Answer): void;
  apply(apply: boolean): void;
};

type Props = {
  payload: Payload;
  readonly: boolean;
  selected: Target | null;
  comments: Comment[];
  /** the person's comments in the round this one revises */
  earlier: Comment[];
  answers: Answer[];
  apply: boolean;
  /** a key pressed to start a comment of this kind */
  compose: ComposeRequest | null;
  edit: Edit;
  select(target: Target | null): void;
};

export type ComposeRequest = { kind: CommentKind; at: number };

/** The newest request a comment box has taken. A box drawn later, for
 *  another part, does not take an older one again. */
let composed = 0;

const mac = navigator.platform.startsWith("Mac");
const altKey = mac ? "⌥" : "Alt+";
const cmdKey = mac ? "⌘" : "Ctrl+";

/** The part a target names, from the payload. */
function find(payload: Payload, target: Target) {
  if ("relationship" in target) return { rel: (payload.relationships ?? []).find((r) => r.id === target.relationship) };
  const table = payload.tables.find((t) => t.name === target.table);
  return { table, column: target.column ? table?.columns.find((c) => c.name === target.column) : undefined };
}

/** A long name, such as a constraint's, may wrap after an underscore or a dot. */
const breakable = (name: string) =>
  name.split(/(?<=[_.])/).map((part, i) => (
    <span key={i}>
      {i > 0 && <wbr />}
      {part}
    </span>
  ));

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="dbs-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const ends = (r: Relationship) =>
  `${r.from.table}(${r.from.columns.join(", ")}) → ${r.to.table}(${r.to.columns.join(", ")})`;

function TableFacts({ table, payload, select }: { table: Table; payload: Payload; select: Props["select"] }) {
  const rels = (payload.relationships ?? []).filter((r) => r.from.table === table.name || r.to.table === table.name);
  return (
    <>
      {table.note && <Md text={table.note} />}
      <Facts
        rows={[
          ["Columns", table.columns.length],
          ...(table.was?.name ? [["Renamed from", <code>{table.was.name}</code>] as [string, React.ReactNode]] : []),
        ]}
      />
      {table.indexes?.length ? (
        <>
          <h4>Indexes</h4>
          <ul className="dbs-indexes">
            {table.indexes.map((i, n) => (
              <li key={i.name ?? n} className={`dbs-index${i.change ? ` dbs-${i.change}` : ""}`}>
                <div className="dbs-index-head">
                  <code className="dbs-index-name">{breakable(i.name ?? "unnamed index")}</code>
                  {i.unique && <span className="dbs-tag">unique</span>}
                  {i.using && <span className="dbs-tag">{i.using}</span>}
                  {i.where && <span className="dbs-tag">partial</span>}
                  {i.change && (
                    <span className={`erd-change erd-change-${i.change}`}>
                      {i.change === "added" ? "new" : i.change}
                    </span>
                  )}
                </div>
                <dl className="dbs-index-facts">
                  <dt>Key</dt>
                  <dd className="dbs-cols">
                    {i.columns.map((c, k) => (
                      <code key={k}>{c}</code>
                    ))}
                  </dd>
                  {i.include?.length ? (
                    <>
                      <dt>Includes</dt>
                      <dd className="dbs-cols dbs-cols-included">
                        {i.include.map((c, k) => (
                          <code key={k}>{c}</code>
                        ))}
                      </dd>
                    </>
                  ) : null}
                  {i.where && (
                    <>
                      <dt>Where</dt>
                      <dd>
                        <code className="dbs-where" dangerouslySetInnerHTML={{ __html: highlightSql(i.where) }} />
                      </dd>
                    </>
                  )}
                </dl>
                {i.note && <Md text={i.note} />}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {rels.length > 0 && (
        <>
          <h4>Relationships</h4>
          <ul className="dbs-links">
            {rels.map((r) => (
              <li key={r.id}>
                <button type="button" className="dbs-link" onClick={() => select({ relationship: r.id })}>
                  {ends(r)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Inspector({
  payload,
  selected,
  comments,
  earlier,
  answers,
  edit,
  readonly,
  select,
  compose,
}: Props & { selected: Target }) {
  const part = find(payload, selected);
  const key = keyOf(selected);
  const mine = comments.filter((c) => c.target && keyOf(c.target) === key);
  const before = earlier.filter((c) => c.target && keyOf(c.target) === key);
  const replyTo = (id: string) => payload.replies?.find((r) => r.id === id)?.text;
  const questions = (payload.questions ?? []).filter((q) => q.about && keyOf(q.about) === key);

  let kind: string;
  let body: React.ReactNode;
  let change: string | undefined;
  if ("relationship" in selected) {
    const r = part.rel;
    kind = "Relationship";
    change = r?.change;
    body = r && (
      <>
        <Facts
          rows={[
            ["From", <code>{`${r.from.table}(${r.from.columns.join(", ")})`}</code>],
            ["To", <code>{`${r.to.table}(${r.to.columns.join(", ")})`}</code>],
            ["Cardinality", r.cardinality ?? "many-to-one"],
            ...(r.on_delete ? [["On delete", r.on_delete] as [string, React.ReactNode]] : []),
            ...(r.on_update ? [["On update", r.on_update] as [string, React.ReactNode]] : []),
          ]}
        />
        {r.note && <Md text={r.note} />}
      </>
    );
  } else if (selected.column) {
    const c = part.column;
    kind = "Column";
    change = c?.change;
    const refs = (payload.relationships ?? []).filter(
      (r) => r.from.table === selected.table && r.from.columns.includes(selected.column!),
    );
    body = c && (
      <>
        <Facts
          rows={[
            [
              "Type",
              c.was?.type && c.was.type !== c.type ? (
                <>
                  <s>{c.was.type}</s> {c.type}
                </>
              ) : (
                <code>{c.type}</code>
              ),
            ],
            [
              "Null",
              c.was?.nullable !== undefined && c.was.nullable !== !!c.nullable ? (
                <>
                  <s>{c.was.nullable ? "NULL" : "NOT NULL"}</s> {c.nullable ? "NULL" : "NOT NULL"}
                </>
              ) : c.nullable ? (
                "NULL"
              ) : (
                "NOT NULL"
              ),
            ],
            ...(c.default !== undefined || c.was?.default !== undefined
              ? [
                  [
                    "Default",
                    <>
                      {c.was?.default !== undefined && c.was.default !== c.default && <s>{c.was.default ?? "none"}</s>}{" "}
                      <code>{c.default ?? "none"}</code>
                    </>,
                  ] as [string, React.ReactNode],
                ]
              : []),
            ...(c.primary_key
              ? [["Key", "primary key"] as [string, React.ReactNode]]
              : c.unique
                ? [["Key", "unique"] as [string, React.ReactNode]]
                : []),
            ...(c.was?.name && c.was.name !== c.name
              ? [["Renamed from", <code>{c.was.name}</code>] as [string, React.ReactNode]]
              : []),
            ...refs.map(
              (r) =>
                [
                  "References",
                  <button type="button" className="dbs-link" onClick={() => select({ relationship: r.id })}>
                    {`${r.to.table}(${r.to.columns.join(", ")})`}
                  </button>,
                ] as [string, React.ReactNode],
            ),
          ]}
        />
        {c.note && <Md text={c.note} />}
      </>
    );
  } else {
    kind = "Table";
    change = part.table?.change;
    body = part.table && <TableFacts table={part.table} payload={payload} select={select} />;
  }

  return (
    <section className="dbs-inspector" aria-label={`${kind} ${labelOf(selected)}`}>
      <div className="dbs-inspector-head">
        <span className="pinrail-eyebrow">{kind}</span>
        {change && <span className={`erd-change erd-change-${change}`}>{change === "added" ? "new" : change}</span>}
        <button
          type="button"
          className="pinrail-btn pinrail-btn-ghost dbs-close"
          onClick={() => select(null)}
          aria-label="Close"
          title="Close"
        >
          <X />
        </button>
      </div>
      <code className="dbs-part">{breakable(labelOf(selected))}</code>
      {body}
      {questions.length > 0 && (
        <>
          <h4>{questions.length === 1 ? "Question from the agent" : "Questions from the agent"}</h4>
          {questions.map((q) => (
            <QuestionItem key={q.id} q={q} answers={answers} edit={edit} readonly={readonly} select={select} compact />
          ))}
        </>
      )}
      {before.length > 0 && (
        <>
          <h4>Last round</h4>
          {before.map((c) => (
            <EarlierItem key={c.id} c={c} reply={replyTo(c.id)} />
          ))}
        </>
      )}
      {(mine.length > 0 || !readonly) && <h4>Comments</h4>}
      {mine.map((c) => (
        <CommentItem key={c.id} c={c} edit={edit} readonly={readonly} />
      ))}
      {!readonly && <Composer key={key} target={selected} edit={edit} compose={compose} />}
    </section>
  );
}

/** The frame a comment is written in: the text, then its kind, and the
 *  buttons that add or save it. */
function CommentBox({
  id,
  initial,
  compose,
  submit,
  cancel,
}: {
  id: string;
  initial?: { kind: CommentKind; text: string };
  compose?: ComposeRequest | null;
  /** the comment as written; true clears the box for the next */
  submit(kind: CommentKind, text: string): boolean;
  /** for an edit: leave the comment as it was */
  cancel?(): void;
}) {
  const [kind, setKind] = useState<CommentKind>(initial?.kind ?? "change");
  const [text, setText] = useState(initial?.text ?? "");
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!compose || compose.at <= composed) return;
    composed = compose.at;
    setKind(compose.kind);
    field.current?.focus();
  }, [compose]);
  useEffect(() => {
    // an edit starts with the cursor after the text
    if (!initial) return;
    const el = field.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
    // only when the edit opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    // ⌘/Ctrl+Enter adds or saves the comment. With the box empty, the SDK
    // takes it up to the app as the hand-over, since nothing prevented it.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === "Enter") {
      if (!text.trim()) return;
      e.preventDefault();
      done();
      return;
    }
    // ⌥C and ⌥Q switch the kind while writing; the code, since ⌥ changes the key
    if (!e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.code === "KeyC" || e.code === "KeyQ") {
      e.preventDefault();
      setKind(e.code === "KeyC" ? "change" : "question");
    }
  };
  const done = () => {
    if (!text.trim()) return;
    if (submit(kind, text.trim())) setText("");
  };
  const editing = !!initial;
  return (
    <div className={`dbs-composer dbs-composer-${kind}`}>
      <textarea
        id={id}
        ref={field}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder={kind === "change" ? "What should change here?" : "What do you want to know?"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        data-pinrail-dictate
        aria-label="Comment"
      />
      <div className="dbs-composer-foot">
        <div className="dbs-kinds" role="group" aria-label="Kind of comment">
          <button
            type="button"
            aria-pressed={kind === "change"}
            onClick={() => setKind("change")}
            title={`Change (C, or ${altKey}C while writing)`}
          >
            <Pencil />
            Change
          </button>
          <button
            type="button"
            aria-pressed={kind === "question"}
            onClick={() => setKind("question")}
            title={`Question (Q, or ${altKey}Q while writing)`}
          >
            <CircleHelp />
            Question
          </button>
        </div>
        <span className="dbs-composer-dictate" data-pinrail-dictate-for={id} />
        {cancel && (
          <button type="button" className="dbs-box-cancel" onClick={cancel}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="dbs-send"
          onClick={done}
          disabled={!text.trim()}
          aria-label={editing ? "Save comment" : "Add comment"}
          title={`${editing ? "Save" : "Add comment"} (${cmdKey}Enter)`}
        >
          {editing ? <Check /> : <ArrowUp />}
        </button>
      </div>
    </div>
  );
}

function Composer({ target, edit, compose }: { target?: Target; edit: Edit; compose: ComposeRequest | null }) {
  return (
    <CommentBox
      id={`compose-${target ? keyOf(target).replace(/[^a-z0-9]/gi, "-") : "schema"}`}
      compose={compose}
      submit={(kind, text) => (edit.add(target, kind, text), true)}
    />
  );
}

/** A comment from the last round, with the agent's reply to it. */
function EarlierItem({ c, reply, select }: { c: Comment; reply?: string; select?: Props["select"] }) {
  return (
    <div className={`dbs-comment dbs-earlier dbs-comment-${c.kind}`}>
      <div className="dbs-comment-head">
        <span className={`dbs-kind dbs-kind-${c.kind}`}>{c.kind}</span>
        {select &&
          (c.target ? (
            <button type="button" className="dbs-link" onClick={() => select(c.target!)}>
              <code>{labelOf(c.target)}</code>
            </button>
          ) : (
            <span className="pinrail-dim">Whole schema</span>
          ))}
      </div>
      <p className="dbs-comment-text">{c.text}</p>
      <div className="dbs-reply">
        <span className="dbs-reply-who">Agent</span>
        {reply ? <Md text={reply} /> : <p className="pinrail-faint">No reply.</p>}
      </div>
    </div>
  );
}

function CommentItem({
  c,
  edit,
  readonly,
  select,
}: {
  c: Comment;
  edit: Edit;
  readonly: boolean;
  select?: Props["select"];
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={`dbs-comment dbs-comment-${c.kind}`}>
      <div className="dbs-comment-head">
        <span className={`dbs-kind dbs-kind-${c.kind}`}>{c.kind}</span>
        {select &&
          (c.target ? (
            <button type="button" className="dbs-link" onClick={() => select(c.target!)}>
              <code>{labelOf(c.target)}</code>
            </button>
          ) : (
            <span className="pinrail-dim">Whole schema</span>
          ))}
        {!readonly && !editing && (
          <span className="dbs-comment-tools">
            <button
              type="button"
              className="pinrail-btn pinrail-btn-ghost"
              onClick={() => setEditing(true)}
              aria-label="Edit comment"
              title="Edit"
            >
              <Pencil />
            </button>
            <button
              type="button"
              className="pinrail-btn pinrail-btn-ghost"
              onClick={() => edit.remove(c.id)}
              aria-label="Delete comment"
              title="Delete"
            >
              <Trash2 />
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <CommentBox
          id={`edit-${c.id}`}
          initial={{ kind: c.kind, text: c.text }}
          submit={(kind, text) => (edit.update(c.id, kind, text), setEditing(false), false)}
          cancel={() => setEditing(false)}
        />
      ) : (
        <p className="dbs-comment-text">{c.text}</p>
      )}
    </div>
  );
}

function QuestionItem({
  q,
  answers,
  edit,
  readonly,
  select,
  compact,
}: {
  q: Question;
  answers: Answer[];
  edit: Edit;
  readonly: boolean;
  select: Props["select"];
  compact?: boolean;
}) {
  const a = answers.find((x) => x.id === q.id);
  const answered = !!(a && (a.choice || a.text?.trim()));
  const set = (patch: Partial<Answer>) => edit.answer({ id: q.id, choice: a?.choice, text: a?.text, ...patch });
  return (
    <div className={`dbs-question${answered ? " dbs-answered" : ""}`} data-question={q.id}>
      {!compact && (
        <div className="dbs-question-head">
          <CircleHelp className="dbs-question-icon" />
          {q.about && (
            <button type="button" className="dbs-link" onClick={() => select(q.about!)}>
              <code>{labelOf(q.about)}</code>
            </button>
          )}
        </div>
      )}
      <Md text={q.text} />
      {q.options && (
        <div className="dbs-options" role="group" aria-label="Options">
          {q.options.map((o) => (
            <button
              key={o}
              type="button"
              className="pinrail-btn"
              aria-pressed={a?.choice === o}
              disabled={readonly}
              onClick={() => set({ choice: a?.choice === o ? undefined : o })}
            >
              {o}
              {o === q.proposal && <span className="dbs-proposed"> · proposed</span>}
            </button>
          ))}
        </div>
      )}
      {readonly ? (
        a?.text ? (
          <p className="dbs-comment-text">{a.text}</p>
        ) : null
      ) : (
        <textarea
          id={`answer-${q.id}`}
          className="pinrail-field"
          rows={2}
          placeholder={q.options ? "Or write your own answer" : "Your answer"}
          value={a?.text ?? ""}
          onChange={(e) => set({ text: e.target.value })}
          data-pinrail-dictate
          aria-label="Answer"
        />
      )}
      {!answered && (
        <p className="pinrail-faint dbs-proposal">
          {readonly ? "Unanswered, so the agent keeps: " : "If you leave it, the agent will go with: "}
          <Md text={q.proposal} inline />
        </p>
      )}
    </div>
  );
}

export type PanelTab = "part" | "questions" | "comments" | "about";

/** The tab the panel opens on when no part is selected. */
export const firstTab = (payload: Payload): PanelTab =>
  payload.summary || !payload.questions?.length ? "about" : "questions";

export function Panel(props: Props & { tab: PanelTab; setTab(tab: PanelTab): void; close(): void }) {
  const { payload, selected, comments, earlier, answers, apply, compose, edit, readonly, select, tab, setTab, close } =
    props;
  const replyTo = (id: string) => payload.replies?.find((r) => r.id === id)?.text;
  const questions = payload.questions ?? [];
  const answered = questions.filter((q) => answers.some((a) => a.id === q.id && (a.choice || a.text?.trim()))).length;
  const shown: PanelTab = tab === "part" && !selected ? firstTab(payload) : tab;
  const schemaComments = comments.filter((c) => !c.target);
  const tabs: [PanelTab, React.ReactNode][] = [
    ...(selected ? [["part", "Selected"] as [PanelTab, React.ReactNode]] : []),
    ...(questions.length
      ? [
          [
            "questions",
            <>
              Questions{" "}
              <span className="dbs-tab-count">
                {answered}/{questions.length}
              </span>
            </>,
          ] as [PanelTab, React.ReactNode],
        ]
      : []),
    [
      "comments",
      <>
        Comments <span className="dbs-tab-count">{comments.length}</span>
      </>,
    ],
    ["about", "About"],
  ];
  return (
    <>
      <div className="dbs-panel-tabs" role="tablist" aria-label="Panel">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={shown === id}
            className="dbs-panel-tab"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="pinrail-btn pinrail-btn-ghost dbs-drawer-close"
          onClick={close}
          aria-label="Close the panel"
          title="Close"
        >
          <X />
        </button>
      </div>
      <div className="dbs-panel-body" role="tabpanel">
        {shown === "part" && selected && <Inspector {...props} selected={selected} />}
        {shown === "questions" &&
          questions.map((q) => (
            <QuestionItem key={q.id} q={q} answers={answers} edit={edit} readonly={readonly} select={select} />
          ))}
        {shown === "comments" && (
          <>
            {comments.length === 0 ? (
              <p className="pinrail-faint dbs-hint">
                {readonly
                  ? "No comments."
                  : "No comments yet. Click a table, a column or a line in the diagram to comment on it."}
              </p>
            ) : (
              <>
                {comments.map((c) => (
                  <CommentItem key={c.id} c={c} edit={edit} readonly={readonly} select={select} />
                ))}
                {!readonly && comments.some((c) => c.kind === "change") && (
                  <label className="dbs-apply">
                    <input type="checkbox" checked={apply} onChange={(e) => edit.apply(e.target.checked)} />
                    <span>
                      Apply my changes without another review
                      <span className="pinrail-faint">
                        {apply
                          ? "The agent applies the changes and goes on."
                          : "The agent makes the changes and sends the schema back for review."}
                      </span>
                    </span>
                  </label>
                )}
              </>
            )}
            {earlier.length > 0 && (
              <>
                <h4 className="dbs-about-head">Last round</h4>
                {earlier.map((c) => (
                  <EarlierItem key={c.id} c={c} reply={replyTo(c.id)} select={select} />
                ))}
              </>
            )}
          </>
        )}
        {shown === "about" && (
          <>
            {payload.dialect && (
              <p className="dbs-dialect">
                <span className="pinrail-chip">{payload.dialect}</span>
              </p>
            )}
            {payload.summary ? (
              <Md text={payload.summary} />
            ) : (
              <p className="pinrail-faint">The agent sent no summary.</p>
            )}
            {earlier.some((c) => !c.target) && (
              <>
                <h4 className="dbs-about-head">Last round, on the whole schema</h4>
                {earlier
                  .filter((c) => !c.target)
                  .map((c) => (
                    <EarlierItem key={c.id} c={c} reply={replyTo(c.id)} />
                  ))}
              </>
            )}
            <h4 className="dbs-about-head">Comments on the whole schema</h4>
            {schemaComments.map((c) => (
              <CommentItem key={c.id} c={c} edit={edit} readonly={readonly} />
            ))}
            {readonly ? (
              !schemaComments.length && <p className="pinrail-faint">None.</p>
            ) : (
              <>
                <Composer edit={edit} compose={compose} />
                <p className="pinrail-faint dbs-hint">
                  To comment on one table, column or line, click it in the diagram.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
