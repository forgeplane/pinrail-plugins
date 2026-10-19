# Add team workspaces

db-schema · acme/tasks · workspaces
Decided by alice at 2026-10-19 09:00

Changes requested. Make the changes below and send the new version for review. Answer the questions below first.

## Changes

- `memberships.role`: Use an enum. We have not added a role in three years.
- The whole schema: Add an updated_at column to every new table.

## Questions from the reviewer

- relationship `projects_workspace_id_fkey`: Why restrict rather than cascade? Archiving first seems like extra work for the user.

## Answers to your questions

- q1, “Should the role be a Postgres `enum` type instead of `text` with a check constraint? An enum is stricter, but adding a role later needs `ALTER TYPE`.”: **enum type**
- q3, “How long should an invitation stay valid?”: Fourteen days. Teams invite people before a holiday.

## Unanswered, so keep your proposal

- q2, “When a member leaves a workspace, what should happen to the tasks assigned to them there?”: Leave them assigned
