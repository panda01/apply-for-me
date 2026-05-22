import { GlobalStyles } from "@mui/material";
import { DESIGN_TOKENS } from "./theme";

const { color, status, radius, sidebar, font } = DESIGN_TOKENS;

/**
 * Shell-level global styles for things the MUI theme cannot encode via component overrides:
 *   - Design-system CSS custom properties (so children can reference --afm-* / --accent / etc.)
 *   - App shell grid (sidebar + main) and the data-sidebar collapse animation
 *   - Sidebar nav item, brand, and user block layout
 *   - Status pill (.pill[data-status=...]) colorways
 *   - Attempt timeline rail bits used by the Job detail page
 *
 * Page-level components should NOT redeclare colors or radii here — pull from the theme
 * (palette/shape) or the DESIGN_TOKENS export above.
 */
function AppGlobalStyles() {
  return (
    <GlobalStyles
      styles={{
        ":root": {
          // colors
          "--bg": color.bg,
          "--surface": color.surface,
          "--surface-sunk": color.surfaceSunk,
          "--surface-hover": color.surfaceHover,
          "--border": color.border,
          "--border-strong": color.borderStrong,
          "--text": color.text,
          "--text-muted": color.textMuted,
          "--text-faint": color.textFaint,
          "--accent": color.accent,
          "--accent-fg": color.accentFg,
          "--accent-tint": color.accentTint,

          // status colors
          "--st-saved-bg": status.saved.bg,
          "--st-saved-fg": status.saved.fg,
          "--st-applied-bg": status.applied.bg,
          "--st-applied-fg": status.applied.fg,
          "--st-interview-bg": status.interview.bg,
          "--st-interview-fg": status.interview.fg,
          "--st-offer-bg": status.offer.bg,
          "--st-offer-fg": status.offer.fg,
          "--st-rejected-bg": status.rejected.bg,
          "--st-rejected-fg": status.rejected.fg,
          "--st-review-bg": status.review.bg,
          "--st-review-fg": status.review.fg,

          // radii
          "--radius-sm": `${radius.sm}px`,
          "--radius": `${radius.md}px`,
          "--radius-lg": `${radius.lg}px`,

          // shell metrics
          "--sidebar-w": `${sidebar.expandedWidth}px`,
          "--sidebar-w-collapsed": `${sidebar.collapsedWidth}px`,

          // density
          "--row-h": "44px",
          "--pad-y": "14px",
          "--pad-x": "16px",

          // fonts
          "--font-sans": font.sans,
          "--font-mono": font.mono,
        },

        "html, body, #root": { height: "100%" },
        body: {
          backgroundColor: color.bg,
          color: color.text,
          fontFamily: font.sans,
          fontFeatureSettings: '"ss01", "cv11"',
        },

        ".mono": { fontFamily: font.mono },

        // ============ App shell ============
        ".app": {
          display: "grid",
          gridTemplateColumns: `${sidebar.expandedWidth}px 1fr`,
          height: "100vh",
          background: color.bg,
          transition: "grid-template-columns 220ms cubic-bezier(.2,.7,.2,1)",
        },
        ".app[data-sidebar='collapsed']": {
          gridTemplateColumns: `${sidebar.collapsedWidth}px 1fr`,
        },

        ".main": {
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minWidth: 0,
        },
        ".topbar": {
          height: 52,
          borderBottom: `1px solid ${color.border}`,
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          gap: 16,
          background: color.bg,
          flexShrink: 0,
        },
        ".content": {
          flex: 1,
          overflowY: "auto",
          padding: "28px 32px 60px",
        },

        // ============ Sidebar ============
        ".sidebar": {
          borderRight: `1px solid ${color.border}`,
          background: color.surfaceSunk,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minWidth: 0,
        },
        ".sb-brand": {
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "16px 14px 14px",
          fontWeight: 600,
          letterSpacing: "-0.01em",
          fontSize: 14,
          color: color.text,
          whiteSpace: "nowrap",
        },
        ".sb-logo": {
          width: 22,
          height: 22,
          borderRadius: 5,
          background: color.accent,
          color: color.accentFg,
          display: "grid",
          placeItems: "center",
          fontSize: 12,
          fontWeight: 600,
          flexShrink: 0,
        },
        ".sb-section": {
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: color.textFaint,
          padding: "14px 16px 6px",
          whiteSpace: "nowrap",
        },
        ".sb-nav": { display: "flex", flexDirection: "column", padding: "0 8px", gap: 1 },
        ".sb-item": {
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 8px",
          borderRadius: `${radius.md}px`,
          color: color.textMuted,
          fontSize: 13,
          whiteSpace: "nowrap",
          cursor: "pointer",
          border: "none",
          background: "transparent",
          textAlign: "left",
          minWidth: 0,
          textDecoration: "none",
          fontFamily: "inherit",
          width: "100%",
        },
        ".sb-item:hover": { background: color.surfaceHover, color: color.text },
        ".sb-item[data-active='true']": {
          background: color.surface,
          color: color.text,
          boxShadow: `inset 0 0 0 1px ${color.border}`,
        },
        ".sb-item .sb-icon": {
          width: 16,
          height: 16,
          flexShrink: 0,
          color: color.textFaint,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        },
        ".sb-item[data-active='true'] .sb-icon": { color: color.accent },
        ".sb-item .count": {
          marginLeft: "auto",
          fontFamily: font.mono,
          fontSize: 11,
          color: color.textFaint,
        },
        ".sb-spacer": { flex: 1 },
        ".sb-bottom": { padding: 10, borderTop: `1px solid ${color.border}` },
        ".sb-user": {
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 8px",
          borderRadius: `${radius.md}px`,
          whiteSpace: "nowrap",
        },
        ".sb-user:hover": { background: color.surfaceHover },
        ".sb-user .avatar": {
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #b39bd6, #d68f6f)",
          color: "white",
          display: "grid",
          placeItems: "center",
          fontSize: 11,
          fontWeight: 600,
          flexShrink: 0,
        },
        ".sb-user .meta": {
          display: "flex",
          flexDirection: "column",
          lineHeight: 1.2,
          minWidth: 0,
        },
        ".sb-user .meta .nm": { fontSize: 12.5, color: color.text, fontWeight: 500 },
        ".sb-user .meta .em": {
          fontSize: 11,
          color: color.textFaint,
          overflow: "hidden",
          textOverflow: "ellipsis",
        },

        // Collapsed sidebar hides labels
        ".app[data-sidebar='collapsed'] .sb-brand span": { display: "none" },
        ".app[data-sidebar='collapsed'] .sb-section": { display: "none" },
        ".app[data-sidebar='collapsed'] .sb-item span:not(.sb-icon)": { display: "none" },
        ".app[data-sidebar='collapsed'] .sb-item .count": { display: "none" },
        ".app[data-sidebar='collapsed'] .sb-user .meta": { display: "none" },
        ".app[data-sidebar='collapsed'] .sb-item, .app[data-sidebar='collapsed'] .sb-brand, .app[data-sidebar='collapsed'] .sb-user": {
          justifyContent: "center",
          padding: 7,
        },

        "@media (max-width: 720px)": {
          ".app": { gridTemplateColumns: `${sidebar.collapsedWidth}px 1fr` },
          ".content": { padding: "20px 16px 40px" },
          ".topbar": { padding: "0 16px" },
          ".searchbox": { display: "none" },
          ".sidebar .sb-brand span": { display: "none" },
          ".sidebar .sb-section": { display: "none" },
          ".sidebar .sb-item span:not(.sb-icon)": { display: "none" },
          ".sidebar .sb-item .count": { display: "none" },
          ".sidebar .sb-user .meta": { display: "none" },
          ".sidebar .sb-item, .sidebar .sb-brand, .sidebar .sb-user": {
            justifyContent: "center",
            padding: 7,
          },
        },

        // ============ Topbar internals ============
        ".tb-title": { fontSize: 14, fontWeight: 500, letterSpacing: "-0.005em", color: color.text },
        ".tb-actions": { marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" },
        ".searchbox": {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 10px",
          border: `1px solid ${color.border}`,
          borderRadius: `${radius.md}px`,
          background: color.surface,
          width: 280,
          color: color.textMuted,
          fontSize: 12.5,
        },
        ".searchbox input": {
          border: "none",
          outline: "none",
          flex: 1,
          background: "transparent",
          fontFamily: "inherit",
          fontSize: "inherit",
          color: "inherit",
          minWidth: 0,
        },
        ".kbd": {
          fontFamily: font.mono,
          fontSize: 10.5,
          padding: "1px 5px",
          border: `1px solid ${color.border}`,
          borderRadius: 3,
          color: color.textFaint,
          background: color.surface,
        },
        ".searchbox .kbd": { marginLeft: "auto" },

        // ============ Page head ============
        ".page-head": {
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 22,
          gap: 16,
          flexWrap: "wrap",
        },
        ".page-title": {
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: "-0.018em",
          margin: "0 0 4px",
          color: color.text,
        },
        ".page-sub": {
          fontSize: 13,
          color: color.textMuted,
          margin: 0,
        },

        // ============ Status pill ============
        ".pill": {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 22,
          padding: "0 9px",
          borderRadius: 999,
          fontSize: 11.5,
          fontWeight: 500,
          letterSpacing: "-0.005em",
          whiteSpace: "nowrap",
        },
        ".pill .dot": { width: 6, height: 6, borderRadius: "50%", background: "currentColor" },
        ".pill[data-status='saved']": { background: status.saved.bg, color: status.saved.fg },
        ".pill[data-status='applied']": { background: status.applied.bg, color: status.applied.fg },
        ".pill[data-status='interview']": { background: status.interview.bg, color: status.interview.fg },
        ".pill[data-status='offer']": { background: status.offer.bg, color: status.offer.fg },
        ".pill[data-status='rejected']": { background: status.rejected.bg, color: status.rejected.fg },
        ".pill[data-status='review']": { background: status.review.bg, color: status.review.fg },

        // ============ Tabs (jobs filter style — distinct from MUI Tabs) ============
        ".tabs": {
          display: "flex",
          gap: 2,
          borderBottom: `1px solid ${color.border}`,
          marginBottom: 16,
          alignItems: "flex-end",
        },
        ".tab": {
          border: "none",
          background: "transparent",
          padding: "8px 12px",
          fontSize: 12.5,
          color: color.textMuted,
          position: "relative",
          marginBottom: -1,
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          fontFamily: "inherit",
        },
        ".tab:hover": { color: color.text },
        ".tab[data-active='true']": {
          color: color.text,
          borderBottom: `1.5px solid ${color.text}`,
          fontWeight: 500,
        },
        ".tab .count": {
          fontFamily: font.mono,
          fontSize: 10.5,
          background: color.surfaceSunk,
          border: `1px solid ${color.border}`,
          padding: "0 5px",
          borderRadius: 3,
          color: color.textFaint,
        },

        // ============ Card / Section ============
        ".card-head": {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          borderBottom: `1px solid ${color.border}`,
        },
        ".card-title": { fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.005em" },
        ".card-body": { padding: 18 },

        ".section-head": {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          margin: "28px 0 12px",
        },
        ".section-head:first-of-type": { marginTop: 0 },
        ".section-head h3": {
          fontSize: 13,
          fontWeight: 600,
          margin: 0,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: color.textMuted,
        },

        // ============ Tags ============
        ".tag": {
          fontSize: 11.5,
          padding: "2px 8px",
          borderRadius: 999,
          background: color.surfaceSunk,
          border: `1px solid ${color.border}`,
          color: color.textMuted,
        },

        // ============ Bulk action bar ============
        ".bulk-bar": {
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 14px 8px 18px",
          background: color.surfaceSunk,
          borderBottom: `1px solid ${color.border}`,
          fontSize: 12.5,
          color: color.text,
        },
        ".bulk-bar .count": { fontWeight: 500 },
        ".bulk-bar .sep": { color: color.textFaint },
        ".bulk-bar .actions": {
          marginLeft: "auto",
          display: "flex",
          gap: 6,
        },

        // ============ Job detail grid ============
        ".job-detail-grid": {
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 300px",
          gap: 24,
          alignItems: "start",
        },
        ".job-detail-main": { minWidth: 0 },
        ".job-detail-side": {
          position: "sticky",
          top: 20,
          display: "flex",
          flexDirection: "column",
        },
        "@media (max-width: 980px)": {
          ".job-detail-grid": { gridTemplateColumns: "1fr" },
          ".job-detail-side": { position: "static" },
          ".form-split": { gridTemplateColumns: "1fr", gap: 24 },
          ".form-preview-col": { position: "static" },
        },

        ".company-logo": {
          width: 42,
          height: 42,
          borderRadius: 8,
          background: color.surfaceSunk,
          border: `1px solid ${color.border}`,
          color: color.textMuted,
          display: "grid",
          placeItems: "center",
          fontWeight: 600,
          fontSize: 16,
          letterSpacing: "-0.02em",
          flexShrink: 0,
        },

        ".req-list": {
          margin: 0,
          paddingLeft: 18,
          color: color.text,
          fontSize: 13.5,
          lineHeight: 1.7,
        },
        ".req-list li": { paddingLeft: 4 },

        ".meta-list": { display: "flex", flexDirection: "column" },
        ".meta-item": {
          display: "grid",
          gridTemplateColumns: "90px 1fr",
          gap: 12,
          padding: "10px 18px",
          fontSize: 12.5,
          borderBottom: `1px solid ${color.border}`,
          alignItems: "center",
        },
        ".meta-item:last-child": { borderBottom: "none" },
        ".meta-key": {
          color: color.textFaint,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontSize: 11,
        },
        ".meta-val": { color: color.text, minWidth: 0 },

        ".manage-list": { display: "flex", flexDirection: "column", padding: 6 },
        ".manage-row": {
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          border: "none",
          background: "transparent",
          color: color.text,
          fontFamily: "inherit",
          fontSize: 13,
          borderRadius: `${radius.md}px`,
          textAlign: "left",
          cursor: "pointer",
          width: "100%",
        },
        ".manage-row .ico": { width: 14, height: 14, color: color.textMuted, flexShrink: 0 },
        ".manage-row:hover": { background: color.surfaceSunk },
        ".manage-row.danger": { color: "#b34a52" },
        ".manage-row.danger .ico": { color: "#b34a52" },
        ".manage-row.danger:hover": { background: "#fbf0f1" },

        // ============ Attempt timeline ============
        ".attempts-list": { display: "flex", flexDirection: "column" },
        ".attempt-row": {
          display: "grid",
          gridTemplateColumns: "36px 1fr",
          gap: 14,
          padding: "16px 18px 16px 16px",
          borderBottom: `1px solid ${color.border}`,
        },
        ".attempt-row:last-child": { borderBottom: "none", paddingBottom: 22 },
        ".attempt-rail": {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          position: "relative",
          paddingTop: 2,
        },
        ".attempt-dot": {
          width: 26,
          height: 26,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          border: `1px solid ${color.border}`,
          background: color.surface,
          zIndex: 1,
        },
        ".attempt-line": {
          flex: 1,
          width: 1,
          background: color.border,
          marginTop: 4,
          minHeight: 14,
        },
        ".attempt-body": {
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        },
        ".attempt-head": {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        },
        ".attempt-time": {
          fontFamily: font.mono,
          fontSize: 11.5,
          color: color.textMuted,
        },
        ".attempt-stats": {
          display: "flex",
          gap: 14,
          fontSize: 11.5,
          color: color.textMuted,
          flexWrap: "wrap",
        },
        ".attempt-stats span": {
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          whiteSpace: "nowrap",
        },
        ".attempt-desc": { fontSize: 12.5, color: color.textMuted },
        ".attempt-note": {
          fontSize: 12.5,
          color: color.text,
          padding: "8px 11px",
          background: color.surfaceSunk,
          border: `1px solid ${color.border}`,
          borderRadius: `${radius.md}px`,
          lineHeight: 1.5,
        },
        ".attempt-pill": {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 22,
          padding: "0 9px",
          borderRadius: 999,
          fontSize: 11.5,
          fontWeight: 500,
          letterSpacing: "-0.005em",
          whiteSpace: "nowrap",
        },
        ".att-ok": { color: "#33683f", background: "#e3f1e7" },
        ".att-err": { color: "#894040", background: "#f5e1e1" },
        ".att-warn": { color: "#7d5a1c", background: "#f5ead1" },
        ".att-mut": { color: color.textMuted, background: color.surfaceSunk },
        ".attempt-dot.att-ok": { borderColor: "#bcdec3", background: "#eef6f0", color: "#33683f" },
        ".attempt-dot.att-err": { borderColor: "#e3c5c5", background: "#f9ecec", color: "#894040" },
        ".attempt-dot.att-warn": { borderColor: "#e5d3a4", background: "#faefd7", color: "#7d5a1c" },
        ".attempt-dot.att-mut": { borderColor: color.borderStrong, background: color.surfaceSunk, color: color.textMuted },

        // ============ Misc tables (jobs) ============
        ".col-title": { fontWeight: 500, color: color.text },
        ".col-co": { color: color.textMuted, fontSize: 12.5 },
        ".cbx-cell": { paddingLeft: "18px !important", paddingRight: "4px !important", width: 36 },

        // ============ Application profiles list ============
        ".profile-row": {
          display: "grid",
          gridTemplateColumns: "40px minmax(0, 1fr) 90px 240px",
          gap: 16,
          padding: "14px 18px",
          borderBottom: `1px solid ${color.border}`,
          alignItems: "center",
        },
        ".profile-row:last-child": { borderBottom: "none" },
        ".profile-row:hover": { background: color.surfaceSunk },
        ".profile-row-avatar": {
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "linear-gradient(135deg, oklch(0.7 0.1 280), oklch(0.65 0.12 30))",
          color: "white",
          display: "grid",
          placeItems: "center",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "-0.02em",
        },
        ".profile-row-label": {
          fontWeight: 500,
          fontSize: 13.5,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
        ".profile-row-meta": {
          fontSize: 12,
          color: color.textMuted,
          fontFamily: font.mono,
          marginTop: 2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
        ".profile-row-stat": {
          fontSize: 12,
          color: color.textMuted,
          fontFamily: font.mono,
          textAlign: "right",
        },
        ".profile-row-stat strong": {
          color: color.text,
          fontWeight: 600,
        },
        ".profile-row-actions": {
          display: "flex",
          gap: 4,
          justifyContent: "flex-end",
          alignItems: "center",
        },

        // ============ Profile (and other) form layout ============
        ".form-page": { maxWidth: 760 },
        ".form-split": {
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 300px",
          gap: 40,
          alignItems: "start",
          maxWidth: 1080,
        },
        ".form-col": { minWidth: 0 },
        ".form-preview-col": {
          position: "sticky",
          top: 20,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        },
        ".row-2": {
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
        },
        ".row-3": {
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 14,
        },
        ".field label .opt": {
          fontWeight: 400,
          color: color.textFaint,
          fontSize: 11,
          marginLeft: 6,
          textTransform: "none",
          letterSpacing: 0,
        },
        ".form-actions": {
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 8,
          marginTop: 24,
          paddingTop: 18,
          borderTop: `1px solid ${color.border}`,
        },
        ".form-actions .save-status": {
          marginRight: "auto",
          fontSize: 12.5,
          color: "oklch(0.5 0.13 150)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        },

        // ============ File picker (profile documents) ============
        ".file-chip": {
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 12px",
          border: `1px solid ${color.border}`,
          borderRadius: `${radius.md}px`,
          background: color.surface,
        },
        ".file-chip-icon": {
          width: 30,
          height: 38,
          border: `1px solid ${color.border}`,
          borderRadius: 4,
          background: color.surfaceSunk,
          position: "relative",
          display: "grid",
          placeItems: "center",
          color: color.textFaint,
          fontFamily: font.mono,
          fontSize: 9,
          letterSpacing: "0.04em",
          flexShrink: 0,
        },
        ".file-chip-name": {
          fontSize: 13,
          fontWeight: 500,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
        ".file-chip-meta": {
          fontSize: 11.5,
          color: color.textMuted,
          fontFamily: font.mono,
          marginTop: 2,
        },
        ".file-empty": {
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          border: `1px dashed ${color.borderStrong}`,
          borderRadius: `${radius.md}px`,
          background: color.surface,
          cursor: "pointer",
          textAlign: "left",
          color: color.text,
          fontFamily: "inherit",
          fontSize: 13,
        },
        ".file-empty:hover": {
          borderColor: color.accent,
          background: color.accentTint,
        },
        ".file-empty-hint": {
          marginLeft: "auto",
          color: color.textFaint,
          fontSize: 12,
        },

        // ============ Danger zone (edit-profile delete) ============
        ".danger-zone": {
          border: "1px solid oklch(0.88 0.04 25)",
          background: "oklch(0.99 0.01 25)",
          borderRadius: `${radius.lg}px`,
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        },

        // ============ Form-split responsive (profile edit page) ============
        // Note: form-split / form-preview-col responsive rules live in the
        // existing "@media (max-width: 980px)" block above (alongside job-detail-grid)
        // to avoid duplicate keys in this TypeScript object literal.
        "@media (max-width: 700px)": {
          ".row-3": { gridTemplateColumns: "1fr" },
        },
        "@media (max-width: 600px)": {
          ".row-2": { gridTemplateColumns: "1fr" },
        },

        // hide scrollbar gutter aesthetics
        ".content::-webkit-scrollbar": { width: 10, height: 10 },
        ".content::-webkit-scrollbar-thumb": { background: "transparent", borderRadius: 5 },
        ".content:hover::-webkit-scrollbar-thumb": { background: color.borderStrong },
      }}
    />
  );
}

export default AppGlobalStyles;
