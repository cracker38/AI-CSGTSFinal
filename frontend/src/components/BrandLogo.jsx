import React from "react";
import { Box, Typography } from "@mui/material";

/**
 * AI-CSGTS brand mark — hex intelligence core + workforce arc.
 * Used in sidebar, app bar, and report covers.
 */
export default function BrandLogo({ size = "md", showTagline = true, variant = "full" }) {
  const iconPx = size === "sm" ? 32 : size === "lg" ? 52 : 40;
  const titleVariant = size === "lg" ? "h6" : size === "sm" ? "caption" : "subtitle2";

  const mark = (
    <Box
      component="svg"
      viewBox="0 0 48 48"
      sx={{ width: iconPx, height: iconPx, flexShrink: 0, display: "block" }}
      aria-hidden
    >
      <defs>
        <linearGradient id="csgts-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1976d2" />
          <stop offset="100%" stopColor="#2e7d32" />
        </linearGradient>
      </defs>
      <path
        d="M24 2 L42 12 V36 L24 46 L6 36 V12 Z"
        fill="url(#csgts-grad)"
        opacity="0.95"
      />
      <path
        d="M24 8 L36 15 V33 L24 40 L12 33 V15 Z"
        fill="none"
        stroke="#fff"
        strokeWidth="1.2"
        opacity="0.55"
      />
      <circle cx="24" cy="22" r="6" fill="#fff" opacity="0.95" />
      <path
        d="M14 30 Q24 18 34 30"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="14" cy="30" r="2" fill="#fff" />
      <circle cx="34" cy="30" r="2" fill="#fff" />
    </Box>
  );

  if (variant === "icon") {
    return mark;
  }

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
      {mark}
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant={titleVariant}
          fontWeight={800}
          sx={{
            lineHeight: 1.15,
            letterSpacing: "0.04em",
            background: "linear-gradient(90deg, #1976d2 0%, #2e7d32 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text"
          }}
        >
          AI-CSGTS
        </Typography>
        {showTagline ? (
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2, display: "block" }}>
            Workforce Intelligence
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
