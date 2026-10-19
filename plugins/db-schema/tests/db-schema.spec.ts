import { expect, test } from "@playwright/test";
import path from "node:path";
import { fixture, mountPlugin } from "pinrail-sdk/testing";

// The view alone, under the harness: no app, no CLI. `mountPlugin` serves
// this folder as the app would and plays the app's side of the protocol.
const dir = path.resolve(__dirname, "..");
const workspaces = () => fixture(path.join(dir, "samples", "workspaces.json"));
const defaults = { direction: "left-to-right", ranking: "network-simplex" };

test("a layout picked in the view stays when the settings come back without it", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: workspaces(), settings: defaults });
  await plugin.frame.getByRole("button", { name: /^Diagram layout/ }).click();
  await plugin.frame.getByRole("menuitemradio", { name: /Tight tree/ }).click();

  // an app that does not know the setting answers with the settings it has
  await plugin.settings({});
  await page.waitForTimeout(200);
  await expect(plugin.frame.getByRole("button", { name: "Diagram layout: Tight tree" })).toBeVisible();
});

test("a layout changed in the app's settings changes the diagram", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: workspaces(), settings: defaults });
  await plugin.settings({ direction: "top-to-bottom", ranking: "longest-path" });
  await expect(plugin.frame.getByRole("button", { name: "Diagram direction: Top to bottom" })).toBeVisible();
  await expect(plugin.frame.getByRole("button", { name: "Diagram layout: Longest path" })).toBeVisible();
});

test("the direction button turns the diagram the other way, and back", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: workspaces(), settings: defaults });
  await plugin.frame.getByRole("button", { name: "Diagram direction: Left to right" }).click();
  await expect(plugin.frame.getByRole("button", { name: "Diagram direction: Top to bottom" })).toBeVisible();
  await plugin.frame.getByRole("button", { name: "Diagram direction: Top to bottom" }).click();
  await expect(plugin.frame.getByRole("button", { name: "Diagram direction: Left to right" })).toBeVisible();
});

const bookmarks = () => fixture(path.join(dir, "samples", "bookmarks.json"));

test("without comments the hand-over approves, and an unanswered question asks first", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: bookmarks(), settings: defaults });
  await expect.poll(() => plugin.lastStatus()).toBe("Approve");

  // the first press only asks, in the confirmation bar
  expect(await plugin.handOver()).toEqual({ deferred: true });
  await expect(plugin.frame.getByText("1 question is unanswered")).toBeVisible();

  // the second goes ahead, and the agent keeps its proposal
  expect(await plugin.handOver()).toMatchObject({
    decision: { data: { verdict: "approve", comments: [], answers: [], unanswered: ["q1"] } },
  });
});

test("Answer it opens the question, and an answer needs no confirmation", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: bookmarks(), settings: defaults });
  expect(await plugin.handOver()).toEqual({ deferred: true });
  await plugin.frame.getByRole("button", { name: "Answer it" }).click();
  await expect(plugin.frame.getByRole("tab", { name: /Questions/ })).toHaveAttribute("aria-selected", "true");
  await plugin.frame.getByRole("button", { name: "Refuse the second one" }).click();
  await expect(plugin.frame.getByText("1 question is unanswered")).toBeHidden();
  expect(await plugin.handOver()).toMatchObject({
    decision: {
      data: { verdict: "approve", answers: [{ id: "q1", choice: "Refuse the second one" }], unanswered: [] },
    },
  });
});

test("a comment asks for changes, unless they are to be applied directly", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: bookmarks(), settings: defaults });
  await plugin.frame.getByRole("button", { name: "Column bookmarks.url" }).click();
  await plugin.frame.getByRole("textbox", { name: "Comment" }).fill("Normalise the URL before saving it.");
  await plugin.frame.getByRole("button", { name: "Add comment" }).click();
  await expect.poll(() => plugin.lastStatus()).toBe("Request 1 change");

  await plugin.frame.getByRole("tab", { name: /Comments/ }).click();
  await plugin.frame.getByRole("checkbox", { name: /Apply my changes/ }).check();
  await expect.poll(() => plugin.lastStatus()).toBe("Approve with 1 change");

  await plugin.handOver(); // the unanswered question asks first
  expect(await plugin.handOver()).toMatchObject({
    decision: {
      data: {
        verdict: "approve",
        comments: [
          {
            target: { table: "bookmarks", column: "url" },
            kind: "change",
            text: "Normalise the URL before saving it.",
          },
        ],
      },
    },
  });
});

test("a question of the person's alone approves, with the question for the agent to answer", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: bookmarks(), settings: defaults });
  await plugin.frame.getByRole("button", { name: "Table tags" }).click();
  await plugin.frame.getByRole("button", { name: "Question", exact: true }).click();
  await plugin.frame.getByRole("textbox", { name: "Comment" }).fill("Why is a tag per user rather than shared?");
  await plugin.frame.getByRole("button", { name: "Add comment" }).click();
  await expect.poll(() => plugin.lastStatus()).toBe("Approve with 1 question");

  // the apply choice is only for changes
  await plugin.frame.getByRole("tab", { name: /Comments/ }).click();
  await expect(plugin.frame.getByRole("checkbox", { name: /Apply my changes/ })).toHaveCount(0);

  await plugin.handOver();
  expect(await plugin.handOver()).toMatchObject({
    decision: { data: { verdict: "approve", comments: [{ kind: "question", target: { table: "tags" } }] } },
  });
});

test("the About tab takes comments on the whole schema", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: bookmarks(), settings: defaults });
  await plugin.frame.getByRole("tab", { name: "About" }).click();
  await plugin.frame.getByRole("textbox", { name: "Comment" }).fill("Add soft deletes to every table.");
  await plugin.frame.getByRole("button", { name: "Add comment" }).click();
  await expect.poll(() => plugin.lastStatus()).toBe("Request 1 change");

  await plugin.handOver();
  const handed = (await plugin.handOver()) as { decision: { data: { comments: Record<string, unknown>[] } } };
  expect(handed.decision.data.comments).toEqual([
    { id: "c1", kind: "change", text: "Add soft deletes to every table." },
  ]);
});

test("q starts a question on the selected part, and Alt+C turns it into a change", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: bookmarks(), settings: defaults });
  await plugin.frame.getByRole("button", { name: "Column bookmarks.title" }).click();
  await plugin.sendKey("q");
  const box = plugin.frame.getByRole("textbox", { name: "Comment" });
  await expect(box).toBeFocused();
  await expect(plugin.frame.getByRole("button", { name: "Question", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await box.press("Alt+KeyC");
  await expect(plugin.frame.getByRole("button", { name: "Change", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(box).toHaveValue("");
});

test("c with nothing selected starts a change on the whole schema", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: bookmarks(), settings: defaults });
  await plugin.frame.getByRole("tab", { name: /Questions/ }).click();
  await plugin.sendKey("c");
  await expect(plugin.frame.getByRole("tab", { name: "About" })).toHaveAttribute("aria-selected", "true");
  await expect(plugin.frame.getByRole("textbox", { name: "Comment" })).toBeFocused();
});

test("an edit can change a comment's text and kind, and Cancel keeps it as it was", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: bookmarks(), settings: defaults });
  await plugin.frame.getByRole("tab", { name: "About" }).click();
  await plugin.frame.getByRole("textbox", { name: "Comment" }).fill("Add soft deletes.");
  await plugin.frame.getByRole("button", { name: "Add comment" }).click();

  await plugin.frame.getByRole("button", { name: "Edit comment" }).click();
  const box = plugin.frame.locator(".dbs-comment").getByRole("textbox", { name: "Comment" });
  await box.fill("Should every table have soft deletes?");
  await plugin.frame.locator(".dbs-comment").getByRole("button", { name: "Question", exact: true }).click();
  await plugin.frame.getByRole("button", { name: "Save comment" }).click();
  await expect(plugin.frame.locator(".dbs-comment-text")).toHaveText("Should every table have soft deletes?");
  await expect.poll(() => plugin.lastStatus()).toBe("Approve with 1 question");

  await plugin.frame.getByRole("button", { name: "Edit comment" }).click();
  await box.fill("Something else");
  await plugin.frame.getByRole("button", { name: "Cancel" }).click();
  await expect(plugin.frame.locator(".dbs-comment-text")).toHaveText("Should every table have soft deletes?");
});

test("Ctrl+Enter adds the comment being written, and in an empty box hands over", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: bookmarks(), settings: defaults });
  await plugin.frame.getByRole("tab", { name: "About" }).click();
  const box = plugin.frame.getByRole("textbox", { name: "Comment" }).last();
  await box.fill("Add soft deletes.");
  await box.press("Control+Enter");
  await expect(plugin.frame.locator(".dbs-comment-text")).toHaveText("Add soft deletes.");
  await expect(box).toHaveValue("");
  expect((await plugin.messages()).filter((m) => m.type === "key")).toHaveLength(0);

  // empty, the press goes up to the app, as the hand-over
  await box.press("Control+Enter");
  await expect.poll(async () => (await plugin.messages()).filter((m) => m.type === "key").length).toBe(1);
});

test("a decided review shows the verdict, the comments and the answers, without controls", async ({ page }) => {
  const decided = fixture(path.join(dir, "fixtures", "workspaces.decided.json"));
  const plugin = await mountPlugin(page, dir, { review: decided, readonly: true, settings: defaults });
  await expect(plugin.frame.getByText("Changes requested")).toBeVisible();
  await plugin.frame.getByRole("tab", { name: /Comments/ }).click();
  await expect(plugin.frame.locator(".dbs-comment")).toHaveCount(3);
  await expect(plugin.frame.getByRole("button", { name: "Edit comment" })).toHaveCount(0);
  await plugin.frame.getByRole("tab", { name: /Questions/ }).click();
  await expect(plugin.frame.getByRole("button", { name: "enum type" })).toHaveAttribute("aria-pressed", "true");
  await expect(plugin.frame.getByText("Unanswered, so the agent keeps:")).toBeVisible();
  await expect(plugin.frame.getByRole("textbox", { name: "Comment" })).toHaveCount(0);
});

test("the side panel hides, and selecting a part shows it again", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: bookmarks(), settings: defaults });
  const panel = plugin.frame.getByRole("complementary", { name: "Comments and questions" });
  await expect(panel).toBeVisible();
  await plugin.frame.getByRole("button", { name: "Hide the side panel" }).click();
  await expect(panel).toBeHidden();
  await plugin.frame.getByRole("button", { name: "Table tags" }).click();
  await expect(panel).toBeVisible();
  await expect(plugin.frame.getByRole("tab", { name: "Selected" })).toHaveAttribute("aria-selected", "true");
});

test("an index shows its key, its covering columns and its condition", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: workspaces(), settings: defaults });
  await plugin.frame.getByRole("button", { name: "Table tasks" }).click();
  const index = plugin.frame.locator(".dbs-index", { hasText: "tasks_open_by_assignee" });
  await expect(index.locator(".dbs-cols").first()).toContainText("created_at desc");
  await expect(index.locator(".dbs-cols-included")).toContainText("done_at");
  await expect(index).toContainText("partial");
  await expect(plugin.frame.locator(".dbs-index", { hasText: "tasks_title_search" })).toContainText("gin");
});

test("a new version shows the last round's comments, each with the agent's reply", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, {
    review: fixture(path.join(dir, "fixtures", "workspaces-r2.json")),
    previous: fixture(path.join(dir, "fixtures", "workspaces.decided.json")),
    settings: defaults,
  });
  await plugin.frame.getByRole("button", { name: "Column memberships.role" }).click();
  const earlier = plugin.frame.locator(".dbs-earlier");
  await expect(earlier).toHaveCount(1);
  await expect(earlier).toContainText("Use an enum.");
  await expect(earlier).toContainText("membership_role");

  await plugin.frame.getByRole("tab", { name: /Comments/ }).click();
  await expect(plugin.frame.locator(".dbs-earlier")).toHaveCount(3);
  await expect(plugin.frame.getByRole("tab", { name: /Comments 0/ })).toBeVisible();
});
