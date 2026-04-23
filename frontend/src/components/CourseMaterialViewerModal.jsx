import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Dialog,
  IconButton,
  LinearProgress,
  Slider,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SmartDisplayIcon from "@mui/icons-material/SmartDisplay";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import { api } from "../api/client";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const PAGE_DWELL_MS = 2800;
const VIDEO_SYNC_MS = 4000;
/** Allow tiny overshoot from keyframes / rounding before treating as skip-ahead. */
const VIDEO_SEEK_AHEAD_LEEWAY_SEC = 2;
const VIDEO_UI_TIME_MS = 400;

function formatVideoClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Full-screen viewer: paginated PDF with dwell-based page completion, or video with watch tracking.
 * Syncs to POST /employee/training-assignments/:id/material-progress (updates course % when in session).
 */
export default function CourseMaterialViewerModal({
  open,
  onClose,
  assignmentId,
  kind,
  title,
  filename,
  sessionActive,
  initialMaterialPct,
  onAfterSync,
  /** Furthest second already credited (server); used so learners cannot skip ahead of watched content. */
  initialVideoMaxPositionSec = 0
}) {
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up("md"));
  const [blobUrl, setBlobUrl] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [materialPct, setMaterialPct] = useState(0);
  const [pagesDoneHint, setPagesDoneHint] = useState(0);
  const dwellTimerRef = useRef(null);
  const videoRef = useRef(null);
  const videoWrapRef = useRef(null);
  const videoSyncTimerRef = useRef(null);
  const lastVideoThrottleRef = useRef(0);
  const maxWatchedRef = useRef(0);
  const seekClampAwaitRef = useRef(false);
  const lastUiTimeRef = useRef(0);
  const [videoFs, setVideoFs] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoVol, setVideoVol] = useState(1);
  const [videoMuted, setVideoMuted] = useState(false);
  const [timeDisplay, setTimeDisplay] = useState({ cur: 0, dur: 0 });

  const clearDwell = useCallback(() => {
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
  }, []);

  const postMaterialProgress = useCallback(
    async (body) => {
      if (!assignmentId) return;
      try {
        const res = await api.post(`/analytics/employee/training-assignments/${assignmentId}/material-progress`, body);
        const payload = res.data?.payload || {};
        const mp = Number(payload.material_progress_pct ?? 0);
        if (!Number.isNaN(mp)) setMaterialPct(mp);
        if (Array.isArray(payload.material_pdf_completed_pages)) {
          setPagesDoneHint(payload.material_pdf_completed_pages.length);
        }
        onAfterSync?.();
      } catch {
        /* silent throttle — parent may show error elsewhere */
      }
    },
    [assignmentId, kind, onAfterSync]
  );

  useEffect(() => {
    if (!open || !assignmentId) return undefined;
    let cancelled = false;
    setLoadError("");
    setBlobUrl(null);
    setNumPages(0);
    setPageNumber(1);
    setPagesDoneHint(0);
    (async () => {
      try {
        const res = await api.get(`/analytics/employee/training-assignments/${assignmentId}/course-material`, {
          responseType: "blob"
        });
        const ct = res.headers["content-type"] || "application/octet-stream";
        const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: ct });
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch (e) {
        if (!cancelled) setLoadError("Could not load course file. Try again or contact HR.");
      }
    })();
    return () => {
      cancelled = true;
      clearDwell();
      setBlobUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
    };
  }, [open, assignmentId, clearDwell]);

  useEffect(() => {
    if (!open) return;
    setMaterialPct(Number(initialMaterialPct) || 0);
  }, [open, initialMaterialPct]);

  useEffect(() => {
    if (!open || kind !== "video") return;
    const sec = Number(initialVideoMaxPositionSec);
    maxWatchedRef.current = Number.isFinite(sec) && sec > 0 ? sec : 0;
    seekClampAwaitRef.current = false;
  }, [open, assignmentId, kind, initialVideoMaxPositionSec]);

  useEffect(() => {
    if (!open || kind !== "pdf" || !numPages || pageNumber < 1) return undefined;
    clearDwell();
    dwellTimerRef.current = setTimeout(() => {
      postMaterialProgress({
        pdf_total_pages: numPages,
        pdf_page_completed: pageNumber
      });
    }, PAGE_DWELL_MS);
    return clearDwell;
  }, [open, kind, numPages, pageNumber, postMaterialProgress, clearDwell]);

  const onPdfLoadSuccess = useCallback(({ numPages: n }) => {
    setNumPages(n);
  }, []);

  const pdfWidth = isMdUp ? Math.min(900, typeof window !== "undefined" ? window.innerWidth - 80 : 900) : Math.max(280, (typeof window !== "undefined" ? window.innerWidth : 360) - 32);

  const pushVideoProgressNow = useCallback(() => {
    const el = videoRef.current;
    if (!el || !assignmentId) return;
    const dur = el.duration;
    const pos = el.currentTime;
    if (!dur || !Number.isFinite(dur) || dur <= 0) return;
    postMaterialProgress({
      video_position_sec: pos,
      video_duration_sec: dur
    });
  }, [assignmentId, postMaterialProgress]);

  const onVideoTimeUpdate = useCallback(() => {
    const el = videoRef.current;
    if (!el || !el.duration) return;
    maxWatchedRef.current = Math.max(maxWatchedRef.current, el.currentTime);
    const now = Date.now();
    if (now - lastUiTimeRef.current >= VIDEO_UI_TIME_MS) {
      lastUiTimeRef.current = now;
      setTimeDisplay({ cur: el.currentTime, dur: el.duration });
    }
    if (now - lastVideoThrottleRef.current < VIDEO_SYNC_MS) return;
    lastVideoThrottleRef.current = now;
    postMaterialProgress({
      video_position_sec: el.currentTime,
      video_duration_sec: el.duration
    });
  }, [postMaterialProgress]);

  const onVideoSeeked = useCallback(() => {
    const el = videoRef.current;
    if (!el || !el.duration) return;
    if (seekClampAwaitRef.current) {
      seekClampAwaitRef.current = false;
      pushVideoProgressNow();
      return;
    }
    const maxW = maxWatchedRef.current;
    if (el.currentTime > maxW + VIDEO_SEEK_AHEAD_LEEWAY_SEC) {
      seekClampAwaitRef.current = true;
      el.currentTime = maxW;
      return;
    }
    pushVideoProgressNow();
  }, [pushVideoProgressNow]);

  const toggleVideoFullscreen = useCallback(async () => {
    const wrap = videoWrapRef.current;
    const vid = videoRef.current;
    const el = wrap || vid;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        if (wrap?.requestFullscreen) await wrap.requestFullscreen();
        else if (vid?.requestFullscreen) await vid.requestFullscreen();
        else if (vid?.webkitEnterFullscreen) vid.webkitEnterFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onFs = () => setVideoFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (!open || kind !== "video") return undefined;
    return () => {
      if (videoSyncTimerRef.current) clearInterval(videoSyncTimerRef.current);
    };
  }, [open, kind]);

  useEffect(() => {
    if (open) return;
    setIsVideoPlaying(false);
    setTimeDisplay({ cur: 0, dur: 0 });
    setVideoVol(1);
    setVideoMuted(false);
    try {
      videoRef.current?.pause();
    } catch {
      /* ignore */
    }
  }, [open]);

  const handleVideoLoaded = useCallback(() => {
    const el = videoRef.current;
    if (el?.duration) setTimeDisplay({ cur: el.currentTime, dur: el.duration });
    pushVideoProgressNow();
  }, [pushVideoProgressNow]);

  const toggleVideoPlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const toggleVideoMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setVideoMuted(el.muted);
  }, []);

  const onVideoVolumeSlider = useCallback((_, value) => {
    const el = videoRef.current;
    const v = Array.isArray(value) ? value[0] : value;
    if (!el) return;
    el.volume = v;
    el.muted = v === 0;
    setVideoVol(v);
    setVideoMuted(v === 0);
  }, []);

  const handleClose = () => {
    clearDwell();
    if (videoSyncTimerRef.current) clearInterval(videoSyncTimerRef.current);
    setBlobUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    onClose?.();
  };

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={handleClose}
      PaperProps={{
        sx: {
          bgcolor: "background.default",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          maxHeight: "100dvh",
          overflow: "hidden"
        }
      }}
    >
      <AppBar position="sticky" elevation={0} color="inherit" sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ gap: 2, flexWrap: "wrap" }}>
          <IconButton edge="start" color="inherit" onClick={handleClose} aria-label="close">
            <CloseIcon />
          </IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
              {kind === "video" ? (
                <SmartDisplayIcon color="primary" />
              ) : (
                <PictureAsPdfIcon color="primary" />
              )}
              <Typography variant="subtitle1" fontWeight={800} noWrap sx={{ maxWidth: { xs: 200, sm: 480 } }}>
                {title || "Course"}
              </Typography>
              {filename ? (
                <Chip size="small" label={filename} variant="outlined" sx={{ maxWidth: 220 }} />
              ) : null}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {kind === "pdf"
                ? `Stay ${PAGE_DWELL_MS / 1000}s on each page to mark it studied. Use arrows to move page by page.`
                : "Watch time is tracked while this window is open. Keep a learning session active for it to count toward course progress."}
            </Typography>
          </Box>
          <Box sx={{ width: { xs: "100%", sm: 220 } }}>
            <Typography variant="caption" color="text.secondary" display="block">
              Content progress
            </Typography>
            <LinearProgress variant="determinate" value={materialPct} sx={{ height: 8, borderRadius: 1 }} />
            <Typography variant="caption" fontWeight={700}>
              {materialPct}%
            </Typography>
          </Box>
        </Toolbar>
      </AppBar>

      {!sessionActive ? (
        <Alert severity="warning" sx={{ m: 2 }}>
          Start a <strong>learning session</strong> on the training card first — then reopen this viewer so page/video progress can raise your official course %.
        </Alert>
      ) : null}

      {loadError ? (
        <Alert severity="error" sx={{ m: 2 }}>
          {loadError}
        </Alert>
      ) : null}

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: kind === "video" ? "hidden" : "auto",
          p: kind === "video" ? 1 : 2,
          pb: kind === "pdf" ? 10 : 2,
          display: kind === "video" ? "flex" : "block",
          flexDirection: kind === "video" ? "column" : undefined
        }}
      >
        {kind === "pdf" && blobUrl ? (
          <Stack alignItems="center" spacing={2}>
            <Document
              file={blobUrl}
              onLoadSuccess={onPdfLoadSuccess}
              onLoadError={() => setLoadError("Invalid or encrypted PDF.")}
              loading={<Typography color="text.secondary">Loading document…</Typography>}
            >
              <Page pageNumber={pageNumber} width={pdfWidth} renderAnnotationLayer renderTextLayer />
            </Document>
          </Stack>
        ) : null}

        {kind === "video" && blobUrl ? (
          <Box
            ref={videoWrapRef}
            sx={{
              flex: 1,
              minHeight: 0,
              width: "100%",
              maxWidth: "100%",
              mx: "auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              bgcolor: "black",
              borderRadius: 2,
              overflow: "hidden"
            }}
          >
            <Box
              component="video"
              ref={videoRef}
              playsInline
              preload="metadata"
              src={blobUrl}
              onLoadedMetadata={handleVideoLoaded}
              onPlay={() => {
                setIsVideoPlaying(true);
                pushVideoProgressNow();
              }}
              onPause={() => {
                setIsVideoPlaying(false);
                pushVideoProgressNow();
              }}
              onSeeked={onVideoSeeked}
              onTimeUpdate={onVideoTimeUpdate}
              onEnded={() => {
                setIsVideoPlaying(false);
                const el = videoRef.current;
                if (!el || !el.duration) return;
                postMaterialProgress({
                  video_position_sec: el.duration,
                  video_duration_sec: el.duration
                });
              }}
              sx={{
                width: "100%",
                flex: 1,
                minHeight: { xs: 260, sm: 360 },
                height: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                bgcolor: "black"
              }}
            />
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              useFlexGap
              flexWrap="wrap"
              sx={{
                px: 1.5,
                py: 1,
                bgcolor: "rgba(0,0,0,0.92)",
                flexShrink: 0,
                borderTop: "1px solid",
                borderColor: "grey.800"
              }}
            >
              <IconButton
                size="small"
                onClick={toggleVideoPlay}
                sx={{ color: "common.white" }}
                aria-label={isVideoPlaying ? "Pause" : "Play"}
              >
                {isVideoPlaying ? <PauseIcon /> : <PlayArrowIcon />}
              </IconButton>
              <Typography
                variant="caption"
                sx={{ color: "grey.200", fontVariantNumeric: "tabular-nums", minWidth: 108 }}
              >
                {formatVideoClock(timeDisplay.cur)} / {formatVideoClock(timeDisplay.dur)}
              </Typography>
              <Typography variant="caption" sx={{ color: "grey.500", display: { xs: "none", sm: "block" }, maxWidth: 200 }} noWrap title="No timeline scrubber — watch in order">
                No seek bar
              </Typography>
              <Box sx={{ flex: 1, minWidth: 8 }} />
              <Typography variant="caption" sx={{ color: "grey.500", mr: -0.5 }} aria-hidden>
                Vol
              </Typography>
              <IconButton
                size="small"
                onClick={toggleVideoMute}
                sx={{ color: "common.white" }}
                aria-label={videoMuted ? "Unmute" : "Mute"}
              >
                {videoMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
              </IconButton>
              <Slider
                size="small"
                value={videoMuted ? 0 : videoVol}
                min={0}
                max={1}
                step={0.05}
                onChange={onVideoVolumeSlider}
                aria-label="Volume"
                sx={{
                  width: { xs: 72, sm: 100 },
                  color: "grey.400",
                  "& .MuiSlider-thumb": { width: 12, height: 12 },
                  "& .MuiSlider-track": { border: "none" }
                }}
              />
              <IconButton
                size="small"
                onClick={toggleVideoFullscreen}
                sx={{ color: "common.white" }}
                aria-label={videoFs ? "Exit fullscreen" : "Fullscreen"}
              >
                {videoFs ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </IconButton>
            </Stack>
          </Box>
        ) : null}
      </Box>

      {kind === "pdf" && numPages > 0 ? (
        <PaperBar pageNumber={pageNumber} numPages={numPages} pagesDoneHint={pagesDoneHint} onPrev={() => setPageNumber((p) => Math.max(1, p - 1))} onNext={() => setPageNumber((p) => Math.min(numPages, p + 1))} />
      ) : null}
    </Dialog>
  );
}

function PaperBar({ pageNumber, numPages, pagesDoneHint, onPrev, onNext }) {
  return (
    <Box
      component="footer"
      sx={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        p: 2,
        bgcolor: "background.paper",
        borderTop: 1,
        borderColor: "divider",
        boxShadow: 6
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="center" spacing={2} flexWrap="wrap" useFlexGap>
        <Button startIcon={<NavigateBeforeIcon />} variant="contained" disabled={pageNumber <= 1} onClick={onPrev}>
          Previous page
        </Button>
        <Chip color="primary" label={`Page ${pageNumber} / ${numPages}`} sx={{ fontWeight: 800 }} />
        {pagesDoneHint > 0 ? <Chip variant="outlined" label={`${pagesDoneHint} pages logged`} /> : null}
        <Button endIcon={<NavigateNextIcon />} variant="contained" disabled={pageNumber >= numPages} onClick={onNext}>
          Next page
        </Button>
      </Stack>
    </Box>
  );
}
