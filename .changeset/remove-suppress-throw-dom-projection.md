---
"slate-dom": major
"slate-react": major
---

Remove `suppressThrow` from DOM-to-Slate projection options. Use `resolveSlatePoint` and `resolveSlateRange` for nullable projection; `toSlatePoint` and `toSlateRange` stay strict.
