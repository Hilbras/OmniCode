---
"@omnicode/cli": patch
---

Say "No matches found" when a search matches nothing instead of "No non-sensitive matches found", which implied files had been filtered out when none were. The filtered wording now appears only when something really was filtered, alongside the line that names the filtered files and how many.
