---
"@hilbras/omnicode": patch
---

Retry a request that fails with an empty 400 body by dropping the prompt cache key, then the output cap, then tools, then thinking, remembering the working shape per model.