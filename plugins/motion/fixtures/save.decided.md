# Save button — round 1

motion · tessel/editor · design
Decided by maya at 2026-09-24 09:12

> Morph, with the fold slowed and the overshoot tamed; the press from Squish.

## Favourite

- **Morph** (`V3`, 1700 ms)
  > The one. It says 'working' without pretending to know how long.
  - 80–400 ms (5–24%): Ease out slower into the circle, over about 450 ms: next to Squish it snaps shut.
    during `.btn` shrink 0%→100%, `.label` fade-out 40%, `.ring` fade-in →17%, `.ring` spin →5% · beside `V1`, `V2`
  - at 1400 ms (82%): Less overshoot as it grows back; at this point it wobbles.
    during `.btn` grow 42%, `.btn` done 80%

## Kept on the shortlist

- **Squish** (`V1`, 1400 ms)
  > Keep the press from this one.
  - at 105 ms (8%): This depth is right; take it into Morph.
    during `.btn` press 25%

## Dropped

- **Fill** (`V2`)
  > A progress bar promises a length we don't know.

Undecided: `V4`
