---
name: feedback-tooltip-disabled-button
description: How to verify MUI Tooltip text on a disabled button via Playwright
metadata:
  type: feedback
---

MUI Tooltip wraps a disabled button in a `<span>` with `data-mui-internal-clone-element="true"` and copies the tooltip `title` into an `aria-label` on that span. The disabled button itself cannot receive hover events — the span intercepts pointer events instead.

To verify the tooltip text is correct without triggering a hover timeout:
- Check that `span[aria-label="<expected tooltip text>"]` exists in the DOM — this is sufficient proof the tooltip is wired with the correct string.
- If you need to hover, target the span wrapper, not the button: `span[aria-label="..."]`

In the accessibility snapshot the tooltip wrapper appears as:
`generic "Fetch the job's info first to find the application form." [ref=eXXX]`

**Why:** Hovering the disabled button always times out because the MUI span intercepts pointer events. The aria-label on the clone span is the canonical proof of tooltip text.

**How to apply:** Whenever verifying a Tooltip on a disabled MUI Button, assert existence of the span's aria-label rather than attempting a hover on the button element.
