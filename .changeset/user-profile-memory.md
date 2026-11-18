---
"@omnicode/cli": patch
---

Know the user's name without being told to search memory. Explicit profile statements — `my name is …`, `call me …`, `I live in …`, `my timezone is …` — are captured as trusted `user_statement` facts and injected into every turn as a `Known about the user` block. A later statement about the same subject supersedes the earlier one; unverified, confidential, and secret records are never injected. Disable the lane with `OMNICODE_EXPERIMENTAL_MEMORY_PROFILE=0`.
