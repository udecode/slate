---
"slate-react": major
---

Rename DOM coverage boundary `selectionPolicy` prop values from `boundary` to `skip` and `model-backed` to `model`.

Remove `not-native-until-mounted` from DOM coverage boundary `findPolicy` prop values. Use `native` for browser find over mounted DOM and `custom` for application-owned model search.

**Migration:** Replace `selectionPolicy="boundary"` with `selectionPolicy="skip"`, and `selectionPolicy="model-backed"` with `selectionPolicy="model"`. Replace `findPolicy="not-native-until-mounted"` with `findPolicy="native"`.
