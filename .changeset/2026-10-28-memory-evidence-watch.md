---
"@hilbras/omnicode": minor
---

Notice a memory going stale in seconds: when experimental memory is on, editing a file that a memory cites demotes that memory instead of waiting for the fifteen-minute sweep, and `/memory list` marks it `(stale)` (OMNICODE_EXPERIMENTAL_MEMORY=1).
