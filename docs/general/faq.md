# FAQ

A series of common questions people have about Slate:

- [Why is content pasted as plain text?](faq.md#why-is-content-is-pasted-as-plaintext)
- [What browsers and devices does Slate support?](faq.md#what-browsers-and-devices-does-slate-support)

## Why is content pasted as plain text?

One of Slate's core principles is that, unlike most other editors, it does **not** prescribe a specific "schema" to the content you are editing. This means that Slate's core has no concept of "block quotes" or "bold formatting".

For the most part, this leads to increased flexibility without many downsides, but there are certain cases where you have to do a bit more work. Pasting is one of those cases.

Since Slate knows nothing about your domain, it can't know how to parse pasted HTML content \(or other content\). So, by default whenever a user pastes content into a Slate editor, it will parse it as plain text. If you want it to be smarter about pasted content, add a `clipboard.insertData` extension handler that deserializes the `DataTransfer` object's `text/html` data and returns `true` when it handles the paste.

## What browsers and devices does Slate support?

Slate targets modern browsers on desktop and mobile devices.

On desktop, Slate focuses on current Chrome, Edge, Firefox, and Safari. Internet Explorer is unsupported.

Mobile support has a different proof shape from desktop support. iOS is supported but not part of every routine local verification pass. Android input uses composition and mutation paths because its `beforeInput` support differs from desktop browsers, so Android behavior needs dedicated proof instead of desktop assumptions.

If you want to add or improve browser or device support, we'd love for you to submit a pull request! Or in the case of incompatible browsers, build a plugin.

For older browsers, such as IE11, a lot of the now standard native APIs aren't available. Slate's position on this is that it is up to the user to bring polyfills \(like [https://polyfill-fastly.io/](https://polyfill-fastly.io/)\) when needed for things like `el.closest`, etc. Otherwise we'd have to bundle and maintain lots of polyfills that others may not even need in the first place. For clarity, Slate makes no guarantees that it will work with older browsers, even with polyfills and at present, there are still unresolved issues with IE11.
