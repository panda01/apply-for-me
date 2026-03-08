import { AppBar, Toolbar, Typography, Button, Box } from "@mui/material";
import { Link as RouterLink, useLocation } from "react-router-dom";

/**
 * Top-level navigation menu displayed on all pages.
 * Uses MUI AppBar with route-aware active state highlighting.
 */
function NavMenu() {
  const location = useLocation();

  const navItems = [
    { label: "Add Job", path: "/" },
    { label: "Jobs List", path: "/jobs" },
  ];

  return (
    <AppBar position="static">
      <Toolbar>
        <Typography variant="h6" component="div" sx={{ mr: 4 }}>
          Apply For Me
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Button
                key={item.path}
                component={RouterLink}
                to={item.path}
                color="inherit"
                variant={isActive ? "outlined" : "text"}
                sx={isActive ? { borderColor: "rgba(255,255,255,0.7)" } : {}}
              >
                {item.label}
              </Button>
            );
          })}
        </Box>
      </Toolbar>
    </AppBar>
  );
}

export default NavMenu;
