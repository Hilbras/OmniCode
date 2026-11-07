---
"@hilbras/omnicode": patch
---

Stop parsing and validating the configuration file twice on every start, which shortens startup for large configurations.