---
"@hilbras/omnicode": patch
---

Serve JSON API responses compressed and delay the search-index warmup by 30 seconds, so opening a session no longer runs behind a CPU spike: config drops from 1.1 MB to 88 KB, the provider catalog from 1.16 MB to 111 KB, and a session transcript from 616 KB to 198 KB.