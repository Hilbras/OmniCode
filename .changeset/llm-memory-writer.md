---
"@omnicode/cli": patch
---

Remember durable facts the assistant notices, not only the ones a fixed pattern matches. After a completed turn the agent asks its model what is worth keeping, and stores only proposals whose quote is copied verbatim from your message — so an inferred or hallucinated fact can never be presented as truth. A later statement on the same subject replaces the earlier value. The extractor is opt-out with `OMNICODE_EXPERIMENTAL_MEMORY_WRITER=0`; rejected proposals (no quote, secret, instruction-shaped, invalid subject) are logged with a reason.
