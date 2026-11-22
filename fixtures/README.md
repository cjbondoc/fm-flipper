# Test fixtures

The repo is public, so full screenshots never get committed. They show the game's
title bar, the currency name and other players' names.

| Folder | In git? | What goes here |
| --- | --- | --- |
| `fixtures/raw/` | No (ignored) | Full screenshots from **Save frame as PNG**. Keep as many as you like. |
| `fixtures/crops/` | Yes | Crops of the listing rows only, with the currency word masked out, each with a ground-truth `.json` next to it. |

## Rules for committed crops

- Crop to the listing panel or a single row. No title bar, shop title, chat box or player names.
- Paint over the currency word after each price. The reader finds that word with a
  template kept outside the repo, so tests don't need it.
- Name each pair the same: `store-001.png` and `store-001.json`.

Ground truth looks like this (one entry per visible row, top to bottom; `null` for an empty row):

```json
{
  "rows": [
    { "name": "Blue Arten", "qty": 1, "price": 279000, "sold": false },
    null
  ]
}
```

Tools to make these crops arrive with the price reader (Phase 4).
