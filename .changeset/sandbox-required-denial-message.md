---
"@omnicode/cli": patch
---

Explain a refused command when `OMNICODE_SANDBOX_MODE=required` and no sandbox backend can be used: the error now says the command will not run, that retrying cannot help, and what to change, instead of only the internal reason.
