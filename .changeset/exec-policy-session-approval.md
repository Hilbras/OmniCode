---
"@omnicode/cli": patch
---

Stop re-prompting for a shell command your exec policy marks as prompting once you approve it for the session: the session approval now satisfies the rule for that exact command instead of asking again on every repeat. `forbidden` rules are unchanged.
