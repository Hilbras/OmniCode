---
"@hilbras/omnicode": patch
---

Require HTTPS for remote MCP servers and refuse private-network endpoints unless the server entry sets `allowPrivateNetwork: true`; a redirect to another host no longer carries the request's credentials.
