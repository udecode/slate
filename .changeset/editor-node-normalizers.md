---
"slate": major
---

Split extension normalizers into `normalizers.editor` for editor-root normalization and `normalizers.node` for non-root node normalization.

**Migration:** Move root/value-level normalizers from `normalizers.node` to `normalizers.editor`.
