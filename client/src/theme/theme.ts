import { createTheme, alpha } from "@mui/material/styles";

/**
 * Design tokens lifted from the Apply for Me design system (claude_tmp/design_package/.../styles.css).
 * Exported so the global style sheet and any one-off `sx` consumers can reference the same values.
 *
 * Colors are expressed as hex strings; the design uses oklch() but for MUI palette compatibility
 * we use sRGB approximations of those oklch colors. The CSS custom properties in globalStyles.tsx
 * keep the original oklch() expressions so cascading styles stay perceptually identical.
 */
export const DESIGN_TOKENS = {
  color: {
    bg: "#fafaf9",
    surface: "#ffffff",
    surfaceSunk: "#f6f5f3",
    surfaceHover: "#f1f0ee",
    border: "#e8e6e3",
    borderStrong: "#d6d3ce",
    text: "#1f1d1b",
    textMuted: "#74716c",
    textFaint: "#a8a59f",
    accent: "#5663d6",
    accentFg: "#ffffff",
    accentTint: "#ecedfa",
  },
  status: {
    saved:     { bg: "#efeeec", fg: "#52504c" },
    applied:   { bg: "#e4ecf7", fg: "#39518d" },
    interview: { bg: "#ece4f5", fg: "#5b3d89" },
    offer:     { bg: "#e3f1e7", fg: "#33683f" },
    rejected:  { bg: "#f5e1e1", fg: "#894040" },
    review:    { bg: "#f5ead1", fg: "#7d5a1c" },
  },
  radius: {
    sm: 4,
    md: 6,
    lg: 10,
  },
  sidebar: {
    expandedWidth: 232,
    collapsedWidth: 56,
  },
  font: {
    sans: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    mono: '"Geist Mono Variable", "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
  },
} as const;

/**
 * Single MUI theme that encodes the design's tokens via palette, typography, shape, and
 * component-level overrides. Page code should rely on this theme rather than re-declaring
 * colors or radii inside `sx` props.
 */
export const theme = createTheme({
  cssVariables: { cssVarPrefix: "afm" },
  palette: {
    mode: "light",
    primary: {
      main: DESIGN_TOKENS.color.text,
      contrastText: DESIGN_TOKENS.color.bg,
    },
    secondary: {
      main: DESIGN_TOKENS.color.accent,
      contrastText: DESIGN_TOKENS.color.accentFg,
      light: DESIGN_TOKENS.color.accentTint,
    },
    text: {
      primary: DESIGN_TOKENS.color.text,
      secondary: DESIGN_TOKENS.color.textMuted,
      disabled: DESIGN_TOKENS.color.textFaint,
    },
    background: {
      default: DESIGN_TOKENS.color.bg,
      paper: DESIGN_TOKENS.color.surface,
    },
    divider: DESIGN_TOKENS.color.border,
    error: { main: "#b34a52" },
    warning: { main: "#a07417" },
    success: { main: "#3a8b5a" },
    info: { main: "#4860c9" },
  },
  shape: { borderRadius: DESIGN_TOKENS.radius.md },
  typography: {
    fontFamily: DESIGN_TOKENS.font.sans,
    fontSize: 13.5,
    htmlFontSize: 16,
    h1: { fontSize: 24, fontWeight: 600, letterSpacing: "-0.018em" },
    h2: { fontSize: 20, fontWeight: 600, letterSpacing: "-0.015em" },
    h3: { fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" },
    h4: { fontSize: 14, fontWeight: 600, letterSpacing: "-0.005em" },
    h5: { fontSize: 13.5, fontWeight: 600 },
    h6: { fontSize: 12.5, fontWeight: 600 },
    body1: { fontSize: 13.5, lineHeight: 1.5 },
    body2: { fontSize: 12.5, lineHeight: 1.5, color: DESIGN_TOKENS.color.textMuted },
    button: { fontSize: 12.5, fontWeight: 500, textTransform: "none", letterSpacing: 0 },
    caption: { fontSize: 11.5, color: DESIGN_TOKENS.color.textFaint },
    overline: {
      fontSize: 11,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: DESIGN_TOKENS.color.textFaint,
      fontWeight: 500,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          fontFeatureSettings: '"ss01", "cv11"',
          WebkitFontSmoothing: "antialiased",
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, disableRipple: false, size: "medium" },
      styleOverrides: {
        root: ({ ownerState }) => ({
          height: ownerState.size === "small" ? 26 : 30,
          padding: ownerState.size === "small" ? "0 10px" : "0 12px",
          borderRadius: DESIGN_TOKENS.radius.md,
          fontWeight: 500,
          fontSize: ownerState.size === "small" ? 12 : 12.5,
          minWidth: 0,
          gap: 6,
          whiteSpace: "nowrap",
          transition: "background-color 100ms, border-color 100ms",
        }),
        outlined: {
          backgroundColor: DESIGN_TOKENS.color.surface,
          borderColor: DESIGN_TOKENS.color.border,
          color: DESIGN_TOKENS.color.text,
          "&:hover": {
            backgroundColor: DESIGN_TOKENS.color.surfaceHover,
            borderColor: DESIGN_TOKENS.color.border,
          },
        },
        contained: {
          backgroundColor: DESIGN_TOKENS.color.text,
          borderColor: DESIGN_TOKENS.color.text,
          color: DESIGN_TOKENS.color.bg,
          "&:hover": {
            backgroundColor: "#2f2c2a",
            borderColor: "#2f2c2a",
          },
        },
        text: {
          color: DESIGN_TOKENS.color.textMuted,
          "&:hover": {
            backgroundColor: DESIGN_TOKENS.color.surfaceHover,
            color: DESIGN_TOKENS.color.text,
          },
        },
        startIcon: { marginRight: 0, marginLeft: 0, "& > *:nth-of-type(1)": { fontSize: 14 } },
        endIcon: { marginLeft: 0, "& > *:nth-of-type(1)": { fontSize: 14 } },
      },
      variants: [
        {
          props: { color: "secondary", variant: "contained" },
          style: {
            backgroundColor: DESIGN_TOKENS.color.accent,
            borderColor: DESIGN_TOKENS.color.accent,
            color: DESIGN_TOKENS.color.accentFg,
            "&:hover": { backgroundColor: DESIGN_TOKENS.color.accent, filter: "brightness(1.08)" },
          },
        },
      ],
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          width: 30,
          height: 30,
          borderRadius: DESIGN_TOKENS.radius.md,
          color: DESIGN_TOKENS.color.textMuted,
          "&:hover": {
            backgroundColor: DESIGN_TOKENS.color.surfaceHover,
            color: DESIGN_TOKENS.color.text,
          },
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: "none",
          backgroundColor: DESIGN_TOKENS.color.surface,
        },
        outlined: {
          borderColor: DESIGN_TOKENS.color.border,
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0, variant: "outlined" },
      styleOverrides: {
        root: {
          backgroundColor: DESIGN_TOKENS.color.surface,
          border: `1px solid ${DESIGN_TOKENS.color.border}`,
          borderRadius: DESIGN_TOKENS.radius.lg,
          overflow: "hidden",
        },
      },
    },
    MuiCardHeader: {
      styleOverrides: {
        root: {
          padding: "14px 18px",
          borderBottom: `1px solid ${DESIGN_TOKENS.color.border}`,
        },
        title: { fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.005em" },
        subheader: { fontSize: 11.5, color: DESIGN_TOKENS.color.textMuted, marginTop: 0 },
        action: { marginTop: 0, marginRight: 0 },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: { padding: 18, "&:last-child": { paddingBottom: 18 } },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: DESIGN_TOKENS.color.border },
      },
    },
    MuiTable: {
      styleOverrides: {
        root: { borderCollapse: "collapse" },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: "14px 16px",
          borderBottom: `1px solid ${DESIGN_TOKENS.color.border}`,
          fontSize: 13,
          color: DESIGN_TOKENS.color.text,
        },
        head: {
          fontWeight: 500,
          fontSize: 11.5,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: DESIGN_TOKENS.color.textFaint,
          background: DESIGN_TOKENS.color.surfaceSunk,
          padding: "10px 16px",
          position: "sticky",
          top: 0,
          zIndex: 1,
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: "background-color 80ms",
          "&:hover td": { background: DESIGN_TOKENS.color.surfaceSunk },
          "&:last-of-type td": { borderBottom: "none" },
          "&[data-selected='true'] td": { background: DESIGN_TOKENS.color.accentTint },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: DESIGN_TOKENS.color.surface,
          fontSize: 13,
          "& .MuiOutlinedInput-notchedOutline": { borderColor: DESIGN_TOKENS.color.border },
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: DESIGN_TOKENS.color.borderStrong },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: DESIGN_TOKENS.color.accent,
            borderWidth: 1,
            boxShadow: `0 0 0 3px ${DESIGN_TOKENS.color.accentTint}`,
          },
        },
        input: {
          padding: "8px 11px",
          height: "auto",
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        root: { fontSize: 13 },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: 12.5,
          fontWeight: 500,
          color: DESIGN_TOKENS.color.text,
          "&.MuiInputLabel-outlined:not(.MuiInputLabel-shrink)": {
            transform: "translate(11px, 8px) scale(1)",
          },
        },
      },
    },
    MuiCheckbox: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: {
          padding: 4,
          color: DESIGN_TOKENS.color.borderStrong,
          "&.Mui-checked, &.MuiCheckbox-indeterminate": {
            color: DESIGN_TOKENS.color.accent,
          },
          "& .MuiSvgIcon-root": { fontSize: 18 },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: {
          minHeight: 36,
          borderBottom: `1px solid ${DESIGN_TOKENS.color.border}`,
        },
        indicator: { backgroundColor: DESIGN_TOKENS.color.text, height: 1.5 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 36,
          padding: "8px 12px",
          fontSize: 12.5,
          fontWeight: 400,
          color: DESIGN_TOKENS.color.textMuted,
          textTransform: "none",
          letterSpacing: 0,
          "&:hover": { color: DESIGN_TOKENS.color.text },
          "&.Mui-selected": { color: DESIGN_TOKENS.color.text, fontWeight: 500 },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          height: 22,
          borderRadius: 999,
          fontSize: 11.5,
          fontWeight: 500,
          letterSpacing: "-0.005em",
          padding: "0 9px",
          "& .MuiChip-label": { padding: 0 },
          "& .MuiChip-icon": { marginLeft: 0, marginRight: 6, fontSize: 14 },
        },
        outlined: {
          backgroundColor: DESIGN_TOKENS.color.surfaceSunk,
          borderColor: DESIGN_TOKENS.color.border,
          color: DESIGN_TOKENS.color.textMuted,
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontSize: 11.5,
          background: DESIGN_TOKENS.color.text,
          color: DESIGN_TOKENS.color.bg,
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: DESIGN_TOKENS.radius.lg,
          fontSize: 12.5,
          border: `1px solid ${DESIGN_TOKENS.color.border}`,
        },
        standardError: {
          backgroundColor: alpha("#b34a52", 0.06),
          color: "#7d3a40",
          border: `1px solid ${alpha("#b34a52", 0.25)}`,
        },
        standardWarning: {
          backgroundColor: alpha("#a07417", 0.06),
          color: "#7d5a1c",
          border: `1px solid ${alpha("#a07417", 0.25)}`,
        },
        standardSuccess: {
          backgroundColor: alpha("#3a8b5a", 0.06),
          color: "#33683f",
          border: `1px solid ${alpha("#3a8b5a", 0.25)}`,
        },
        standardInfo: {
          backgroundColor: alpha("#4860c9", 0.06),
          color: "#39518d",
          border: `1px solid ${alpha("#4860c9", 0.25)}`,
        },
      },
    },
    MuiLink: {
      defaultProps: { underline: "hover" },
      styleOverrides: {
        root: {
          color: DESIGN_TOKENS.color.text,
          textDecorationColor: DESIGN_TOKENS.color.borderStrong,
        },
      },
    },
  },
});

export default theme;
