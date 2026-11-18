---
"@omnicode/cli": minor
---

Add a structured headless contract. `-p` can now be validated against a JSON Schema with `--json-schema <path>` (the schema is appended to the prompt and a non-conforming or non-JSON answer exits non-zero), and the prompt can be read from stdin with `--input-format text|stream-json` (newline-delimited objects with `text` or `content` parts). `--output-format stream-json` continues to carry the event stream; exit codes are documented in the CLI README.
