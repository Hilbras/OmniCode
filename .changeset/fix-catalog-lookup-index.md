---
"@hilbras/omnicode": patch
"@hilbras/omnicode-desktop": patch
---

Index the model catalog by alias so looking up a model no longer rebuilds and re-sorts its whole provider bucket. On a large catalog this cuts the model and provider listing endpoints from tens of seconds to milliseconds.
