import { createElement, type ReactElement } from "react";
import { GlobalStyles } from "@mui/material";
import { DESIGN_TOKENS } from "./theme";

const { color, radius, font } = DESIGN_TOKENS;

/**
 * Inbox-page-specific global styles. Ported verbatim from the design package's
 * styles.css blocks for `.period-bar`, `.seg-control`, `.select-bar`,
 * `.disc-group(s)`, `.email-tag`, `.disc-row`, `.disc-cbx`, `.disc-logo`,
 * `.disc-main`, `.disc-titlerow`, `.disc-title`, `.disc-meta`, `.disc-source`,
 * `.disc-actions`, and the `.disc-pill-*` colorways.
 *
 * Implemented with `createElement` rather than JSX so this file can keep the
 * `.ts` extension specified by the parallel-fan-out spec (JSX requires
 * `.tsx`). Behavior is identical to a JSX `<GlobalStyles>` call.
 *
 * @returns {ReactElement} A MUI GlobalStyles element with the inbox CSS
 */
export function InboxGlobalStyles(): ReactElement {
  return createElement(GlobalStyles, {
    styles: {
      // ============ Period bar (inbox) ============
      ".period-bar": {
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 16px",
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: `${radius.lg}px`,
        marginBottom: 14,
        flexWrap: "wrap",
      },
      ".period-label": {
        fontSize: 12.5,
        color: color.textMuted,
        whiteSpace: "nowrap",
      },
      ".period-summary": {
        marginLeft: "auto",
        fontSize: 12,
        color: color.textMuted,
        fontFamily: font.mono,
        whiteSpace: "nowrap",
      },
      ".period-summary strong": { color: color.text, fontWeight: 600 },

      // ============ Segmented control (period) ============
      ".seg-control": {
        display: "inline-flex",
        padding: 2,
        background: color.surfaceSunk,
        border: `1px solid ${color.border}`,
        borderRadius: `${radius.md}px`,
      },
      ".seg-btn": {
        border: "none",
        background: "transparent",
        padding: "5px 12px",
        fontFamily: "inherit",
        fontSize: 12.5,
        color: color.textMuted,
        borderRadius: 4,
        cursor: "pointer",
        transition: "background 80ms, color 80ms",
        textTransform: "none",
        minWidth: 0,
        lineHeight: 1.2,
      },
      ".seg-btn:hover": { color: color.text, background: "transparent" },
      ".seg-btn[data-active='true']": {
        background: color.surface,
        color: color.text,
        boxShadow: `0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px ${color.borderStrong}`,
      },

      // ============ Selection bar (above grouped list) ============
      ".select-bar": {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        background: color.surfaceSunk,
        border: `1px solid ${color.border}`,
        borderRadius: `${radius.md}px`,
        marginBottom: 14,
      },
      ".select-bar-toggle": {
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 12.5,
        color: color.text,
        cursor: "pointer",
      },
      ".select-bar-toggle strong": { fontWeight: 600 },

      // ============ Discovery groups ============
      ".disc-groups": { display: "flex", flexDirection: "column", gap: 16 },
      ".disc-group": {
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: `${radius.lg}px`,
        overflow: "hidden",
      },
      ".disc-group-head": {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 16px 6px",
        flexWrap: "wrap",
      },
      ".disc-group-time": {
        marginLeft: "auto",
        fontSize: 11.5,
        color: color.textFaint,
        fontFamily: font.mono,
      },
      ".disc-group-snippet": {
        padding: "0 16px 12px",
        fontSize: 12.5,
        color: color.textMuted,
        fontStyle: "italic",
        borderBottom: `1px solid ${color.border}`,
      },
      ".disc-group-body": { display: "flex", flexDirection: "column" },

      // ============ Email tag (deep-link into Gmail) ============
      ".email-tag": {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px 3px 6px",
        border: `1px solid ${color.border}`,
        borderRadius: 999,
        fontSize: 11.5,
        color: color.text,
        background: color.surface,
        textDecoration: "none",
        maxWidth: "100%",
        minWidth: 0,
      },
      ".email-tag:hover": {
        background: color.surfaceSunk,
        borderColor: color.borderStrong,
      },
      ".email-tag .ico": { width: 12, height: 12, color: color.textMuted },
      ".email-tag-dot": {
        width: 6,
        height: 6,
        borderRadius: 2,
        flexShrink: 0,
      },
      ".email-tag-from": { fontWeight: 500, whiteSpace: "nowrap" },
      ".email-tag-sep": { color: color.textFaint },
      ".email-tag-subject": {
        color: color.textMuted,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
        maxWidth: 360,
      },

      // ============ Discovered row ============
      ".disc-row": {
        display: "grid",
        gridTemplateColumns: "30px 36px 1fr auto",
        gap: 14,
        padding: "14px 16px",
        borderTop: `1px solid ${color.border}`,
        alignItems: "center",
        transition: "background 80ms",
      },
      ".disc-group-body .disc-row:first-of-type": { borderTop: "none" },
      ".disc-row[data-state='dismissed']": { opacity: 0.55 },
      ".disc-row[data-state='dismissed']:hover": { opacity: 0.85 },
      ".disc-row[data-selected='true']": { background: color.accentTint },
      ".disc-row:hover:not([data-selected='true'])": { background: color.surfaceSunk },

      ".disc-cbx": { display: "grid", placeItems: "center" },
      ".disc-logo": {
        width: 36,
        height: 36,
        borderRadius: 8,
        fontSize: 14,
      },
      ".disc-main": {
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 5,
      },
      ".disc-titlerow": {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      },
      ".disc-title": {
        fontSize: 13.5,
        fontWeight: 500,
        color: color.text,
      },
      ".disc-meta": {
        fontSize: 12.5,
        color: color.textMuted,
        display: "flex",
        alignItems: "center",
        gap: 7,
        flexWrap: "wrap",
      },
      ".disc-meta .dotsep": { color: color.textFaint },
      ".dotsep": { color: color.textFaint },

      ".disc-source": {
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        marginTop: 2,
      },
      ".disc-source-time": {
        fontSize: 11,
        color: color.textFaint,
        fontFamily: font.mono,
      },
      ".disc-source-link": {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        border: "none",
        background: "transparent",
        padding: 0,
        fontFamily: "inherit",
        fontSize: 11.5,
        color: color.accent,
        cursor: "pointer",
        borderBottom: "1px dotted currentColor",
      },
      ".disc-source-link:hover": { filter: "brightness(0.85)" },
      ".disc-source-link .ico": { width: 11, height: 11 },

      ".disc-actions": {
        display: "flex",
        gap: 6,
        alignItems: "center",
      },

      // ============ Status pills on discovered rows ============
      ".disc-pill-new": {
        background: "oklch(0.95 0.04 240)",
        color: "oklch(0.42 0.13 250)",
        height: 20,
        padding: "0 8px",
        fontSize: 11,
      },
      ".disc-pill-dup": {
        background: "oklch(0.96 0.025 60)",
        color: "oklch(0.45 0.12 60)",
        height: 20,
        padding: "0 8px",
        fontSize: 11,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      },
      ".disc-pill-dup .ico": { width: 11, height: 11 },
      ".disc-pill-imported": {
        background: "oklch(0.95 0.04 145)",
        color: "oklch(0.4 0.12 145)",
        height: 20,
        padding: "0 8px",
        fontSize: 11,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      },
      ".disc-pill-imported .ico": { width: 11, height: 11 },
      ".disc-pill-dismissed": {
        background: "oklch(0.95 0.005 80)",
        color: color.textFaint,
        height: 20,
        padding: "0 8px",
        fontSize: 11,
      },
      ".disc-pill-link": {
        border: "none",
        background: "transparent",
        padding: 0,
        font: "inherit",
        color: "inherit",
        cursor: "pointer",
        textDecoration: "underline",
        textUnderlineOffset: "2px",
      },
      ".disc-pill-link:hover": { filter: "brightness(0.7)" },
    },
  });
}
