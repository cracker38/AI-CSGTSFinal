import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  LinearProgress,
  Link,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, getApiBaseUrl } from "../api/client";
import { setAuth } from "../auth/authStore";
import { dashboardPathForRole } from "../auth/roleRouting";
import { getApiErrorMessage } from "../utils/apiError";

const VERIFY_BG = "#1a3d2e";
const VERIFY_ACCENT = "#f4a261";

const emptyOtpCells = () => ["", "", "", "", "", ""];

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(true);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [otpCells, setOtpCells] = useState(emptyOtpCells);
  const [otpRequestId, setOtpRequestId] = useState("");
  const [otpStep, setOtpStep] = useState(false);
  const [resendInSeconds, setResendInSeconds] = useState(0);
  const otpInputRefs = useRef([]);
  /** idle = still probing; ok = /auth/ping succeeded; fail = cannot reach API (proxy or uvicorn). */
  const [apiProbe, setApiProbe] = useState("idle");

  useEffect(() => {
    const base = getApiBaseUrl();
    const url = `${base}/auth/ping`;
    const ac = new AbortController();
    const to = window.setTimeout(() => ac.abort(), 10_000);
    fetch(url, { method: "GET", signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => {
        if (j && j.ok === true) setApiProbe("ok");
        else setApiProbe("fail");
      })
      .catch(() => setApiProbe("fail"))
      .finally(() => window.clearTimeout(to));
    return () => {
      window.clearTimeout(to);
      ac.abort();
    };
  }, []);

  useEffect(() => {
    const savedEmail = window.localStorage.getItem("aicsgts_last_email");
    if (savedEmail) setEmail(savedEmail);
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem("aicsgts_registration_submitted") !== "1") return;
    sessionStorage.removeItem("aicsgts_registration_submitted");
    setInfo("Registration submitted. Your account is pending approval — you can sign in once an administrator activates it.");
  }, []);

  useEffect(() => {
    if (!otpStep || resendInSeconds <= 0) return undefined;
    const timer = window.setInterval(() => {
      setResendInSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [otpStep, resendInSeconds]);

  const emailNorm = useMemo(() => String(email).trim().toLowerCase(), [email]);
  const emailValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm), [emailNorm]);
  const passwordStrongEnough = password.length >= 8;
  const canSubmit = emailValid && passwordStrongEnough && !busy;

  async function doLogin() {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      const res = await api.post("/auth/login", { email: emailNorm, password });
      if (res.data?.requires_otp) {
        setOtpCells(emptyOtpCells());
        setOtpStep(true);
        setOtpRequestId(res.data.otp_request_id || "");
        setResendInSeconds(60);
        setInfo(`A 6-digit OTP was sent to ${emailNorm}. Enter it below to complete login.`);
        return;
      }
      setAuth({ ...res.data, email: emailNorm });
      if (rememberEmail) window.localStorage.setItem("aicsgts_last_email", emailNorm);
      else window.localStorage.removeItem("aicsgts_last_email");
      if (res.data.must_change_password) navigate("/change-password");
      else navigate(dashboardPathForRole(res.data.role));
    } catch (err) {
      const status = err?.response?.status;
      let msg = getApiErrorMessage(err, "Login failed");
      if (status === 403) {
        msg += " If your account is pending approval, contact your HR admin.";
      } else if (status === 401) {
        msg += " Check that your email and password match your account (passwords are case-sensitive).";
      } else if (status === 0 || !err?.response) {
        msg += " Server is unreachable right now. Please try again in a moment.";
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function doVerifyOtp() {
    setError("");
    setInfo("");
    const code = otpCells.join("").replace(/\D/g, "").slice(0, 6);
    setBusy(true);
    try {
      const res = await api.post("/auth/verify-otp", {
        email: emailNorm,
        otp_request_id: otpRequestId,
        otp_code: code
      });
      setAuth({ ...res.data, email: emailNorm });
      if (rememberEmail) window.localStorage.setItem("aicsgts_last_email", emailNorm);
      else window.localStorage.removeItem("aicsgts_last_email");
      if (res.data.must_change_password) navigate("/change-password");
      else navigate(dashboardPathForRole(res.data.role));
    } catch (err) {
      setError(getApiErrorMessage(err, "OTP verification failed"));
    } finally {
      setBusy(false);
    }
  }

  async function doResendOtp() {
    if (!otpRequestId || resendInSeconds > 0) return;
    setError("");
    setInfo("");
    setBusy(true);
    try {
      const res = await api.post("/auth/resend-otp", {
        email: emailNorm,
        otp_request_id: otpRequestId
      });
      setOtpRequestId(res.data.otp_request_id);
      setResendInSeconds(res.data.resend_cooldown_seconds || 60);
      setInfo(`A new OTP was sent to ${emailNorm}.`);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to resend OTP"));
    } finally {
      setBusy(false);
    }
  }

  const otpJoined = useMemo(() => otpCells.join("").replace(/\D/g, "").slice(0, 6), [otpCells]);

  useEffect(() => {
    if (!otpStep) return;
    const t = window.setTimeout(() => otpInputRefs.current[0]?.focus(), 100);
    return () => window.clearTimeout(t);
  }, [otpStep]);

  function setOtpDigitAt(index, digit) {
    const d = digit.replace(/\D/g, "").slice(-1) || "";
    setOtpCells((prev) => {
      const next = [...prev];
      next[index] = d;
      return next;
    });
    if (d && index < 5) {
      window.requestAnimationFrame(() => otpInputRefs.current[index + 1]?.focus());
    }
  }

  function handleOtpKeyDown(index, e) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (otpCells[index]) {
        setOtpCells((prev) => {
          const next = [...prev];
          next[index] = "";
          return next;
        });
      } else if (index > 0) {
        otpInputRefs.current[index - 1]?.focus();
      }
      return;
    }
    if (e.key === "ArrowLeft" && index > 0) otpInputRefs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < 5) otpInputRefs.current[index + 1]?.focus();
  }

  function handleOtpPaste(e) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = emptyOtpCells();
    for (let i = 0; i < text.length; i += 1) next[i] = text[i];
    setOtpCells(next);
    const focusAt = Math.min(text.length, 5);
    window.requestAnimationFrame(() => otpInputRefs.current[focusAt]?.focus());
  }

  function onSubmit(e) {
    e.preventDefault();
    if (otpStep) {
      if (otpJoined.length !== 6 || !otpRequestId) {
        setError("Enter the 6-digit OTP sent to your email.");
        return;
      }
      void doVerifyOtp();
      return;
    }
    setTouched({ email: true, password: true });
    if (!canSubmit) return;
    void doLogin();
  }

  if (otpStep) {
    return (
      <Box
        component="main"
        sx={{
          minHeight: "100vh",
          width: "100%",
          bgcolor: VERIFY_BG,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          px: 2,
          py: 4,
          boxSizing: "border-box"
        }}
      >
        <Typography
          component="h1"
          sx={{
            color: "#fff",
            fontWeight: 600,
            fontSize: { xs: "1.35rem", sm: "1.6rem" },
            mb: 2.5,
            textAlign: "center",
            letterSpacing: "0.02em"
          }}
        >
          Verify Your Identity
        </Typography>

        <Box
          component="form"
          onSubmit={onSubmit}
          onPaste={handleOtpPaste}
          sx={{
            width: "100%",
            maxWidth: 440,
            bgcolor: "#fff",
            borderRadius: "14px",
            px: { xs: 2.5, sm: 4 },
            py: { xs: 3, sm: 4 },
            boxShadow: "0 20px 50px rgba(0,0,0,0.25)"
          }}
        >
          <Stack spacing={3} alignItems="center">
            {busy ? <LinearProgress sx={{ width: "100%", borderRadius: 1 }} /> : null}
            {info ? (
              <Alert severity="success" sx={{ width: "100%" }}>
                {info}
              </Alert>
            ) : null}
            {error ? (
              <Alert severity="error" sx={{ width: "100%" }}>
                {error}
              </Alert>
            ) : null}

            <Typography
              sx={{
                color: "rgba(0,0,0,0.75)",
                fontSize: { xs: "0.9rem", sm: "0.95rem" },
                textAlign: "center",
                lineHeight: 1.55,
                maxWidth: 360
              }}
            >
              Protecting your account is our priority. Please confirm your identity by providing the code sent to your
              email.
            </Typography>

            <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center" }}>
              Sent to <strong>{emailNorm}</strong>
            </Typography>

            <Stack
              direction="row"
              spacing={{ xs: 0.75, sm: 1.25 }}
              justifyContent="center"
              flexWrap="wrap"
              rowGap={1}
              sx={{ width: "100%" }}
            >
              {otpCells.map((digit, index) => (
                <TextField
                  key={index}
                  inputRef={(el) => {
                    otpInputRefs.current[index] = el;
                  }}
                  value={digit}
                  onChange={(e) => setOtpDigitAt(index, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(index, e)}
                  inputProps={{
                    inputMode: "numeric",
                    pattern: "[0-9]*",
                    maxLength: 1,
                    "aria-label": `Digit ${index + 1} of 6`,
                    style: { textAlign: "center", fontSize: "1.25rem", fontWeight: 600, padding: "12px 0" }
                  }}
                  sx={{
                    width: { xs: 42, sm: 48 },
                    flexShrink: 0,
                    "& .MuiOutlinedInput-root": {
                      borderRadius: 1.25,
                      bgcolor: "#fff",
                      "& fieldset": { borderColor: "rgba(0,0,0,0.12)" },
                      "&:hover fieldset": { borderColor: "rgba(0,0,0,0.22)" },
                      "&.Mui-focused fieldset": { borderColor: VERIFY_BG, borderWidth: 2 }
                    }
                  }}
                />
              ))}
            </Stack>

            <Stack direction="row" spacing={2} sx={{ width: "100%", pt: 0.5 }}>
              <Button
                type="button"
                variant="outlined"
                fullWidth
                onClick={() => {
                  setOtpStep(false);
                  setOtpCells(emptyOtpCells());
                  setOtpRequestId("");
                  setResendInSeconds(0);
                  setInfo("");
                  setError("");
                }}
                sx={{
                  borderRadius: 999,
                  py: 1.25,
                  textTransform: "none",
                  fontWeight: 600,
                  color: "#111",
                  borderColor: "#111",
                  bgcolor: "#fff",
                  "&:hover": { borderColor: "#111", bgcolor: "rgba(0,0,0,0.04)" }
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={busy || otpJoined.length !== 6}
                sx={{
                  borderRadius: 999,
                  py: 1.25,
                  textTransform: "none",
                  fontWeight: 600,
                  bgcolor: VERIFY_BG,
                  boxShadow: "none",
                  "&:hover": { bgcolor: "#234d3a", boxShadow: "none" },
                  "&.Mui-disabled": { bgcolor: "rgba(26,61,46,0.35)", color: "#fff" }
                }}
              >
                {busy ? "Verifying…" : "Verify"}
              </Button>
            </Stack>

            <Typography variant="body2" sx={{ color: "rgba(0,0,0,0.55)", textAlign: "center", fontSize: "0.85rem" }}>
              It may take a minute to receive the verification message. Haven&apos;t received it yet?{" "}
              <Link
                component="button"
                type="button"
                underline="always"
                disabled={busy || resendInSeconds > 0 || !otpRequestId}
                onClick={() => void doResendOtp()}
                sx={{
                  color: VERIFY_ACCENT,
                  fontWeight: 600,
                  cursor: resendInSeconds > 0 ? "default" : "pointer",
                  verticalAlign: "baseline",
                  border: "none",
                  background: "none",
                  p: 0,
                  font: "inherit"
                }}
              >
                {resendInSeconds > 0 ? `Resend (${resendInSeconds}s)` : "Resend"}
              </Link>
            </Typography>
          </Stack>
        </Box>
      </Box>
    );
  }

  return (
    <AppShell title="AI-CSGTS">
      <Box
        sx={{
          mx: "auto",
          width: "100%",
          maxWidth: 1160,
          px: { xs: 0, sm: 1 },
          py: { xs: 0, md: 2 }
        }}
      >
        <Grid container spacing={{ xs: 1.5, md: 3 }} alignItems="center">
          <Grid item xs={12} md={6} order={{ xs: 2, md: 1 }}>
            <Stack spacing={2} sx={{ px: { xs: 0.5, md: 1.5 }, pb: { xs: 1, md: 0 } }}>
              <Typography
                variant="overline"
                sx={{ color: "primary.main", fontWeight: 700, letterSpacing: "0.08em" }}
              >
                AI-CSGTS PLATFORM
              </Typography>
              <Typography variant="h3" fontWeight={800} sx={{ fontSize: { xs: "1.9rem", sm: "2.3rem", md: "2.8rem" }, lineHeight: 1.15 }}>
                Smarter Workforce
                <br />
                Decisions, Faster
              </Typography>
              <Typography color="text.secondary" sx={{ maxWidth: 520, fontSize: { xs: "0.95rem", md: "1rem" } }}>
                Sign in to the AI-Powered Competency & Skill Gap Tracking System and access secure role-based analytics,
                training intelligence, and strategic staffing insights.
              </Typography>
              <Stack direction="row" spacing={1.2} sx={{ flexWrap: "wrap", gap: 1 }}>
                <Box sx={{ px: 1.4, py: 0.7, borderRadius: 2, bgcolor: "action.hover", fontSize: 13 }}>AI Skill Gap Analysis</Box>
                <Box sx={{ px: 1.4, py: 0.7, borderRadius: 2, bgcolor: "action.hover", fontSize: 13 }}>Secure OTP Login</Box>
                <Box sx={{ px: 1.4, py: 0.7, borderRadius: 2, bgcolor: "action.hover", fontSize: 13 }}>Role-Based Dashboards</Box>
              </Stack>
            </Stack>
          </Grid>

          <Grid item xs={12} md={6} order={{ xs: 1, md: 2 }}>
            <Card
              variant="outlined"
              sx={{
                height: "100%",
                borderRadius: 4,
                border: "1px solid",
                borderColor: "divider",
                boxShadow: "0 14px 34px rgba(0,0,0,0.14)"
              }}
            >
              <CardContent sx={{ p: { xs: 2.2, sm: 2.6, md: 3.4 } }}>
                <Stack spacing={{ xs: 1.25, md: 1.6 }}>
                  <Box>
                    <Typography variant="h5" fontWeight={800} sx={{ fontSize: { xs: "1.35rem", sm: "1.5rem", md: "1.65rem" } }}>
                      Sign in
                    </Typography>
                    <Typography color="text.secondary" sx={{ fontSize: { xs: "0.9rem", md: "0.95rem" } }}>
                      Continue to your secure AI-CSGTS workspace.
                    </Typography>
                  </Box>

                  {/* Native <form> so submit + Enter work reliably; MUI Stack as form can miss submits in some cases. */}
                  <form onSubmit={onSubmit}>
                    <Stack spacing={{ xs: 1.2, sm: 1.5, md: 1.8 }}>
                      {busy ? <LinearProgress /> : null}
                      {import.meta.env.DEV && apiProbe === "fail" ? (
                        <Alert severity="warning">
                          Cannot reach the API at <code>{getApiBaseUrl()}/auth/ping</code> within 10 seconds. Start
                          uvicorn on port <strong>8010</strong> (or the port in your <code>VITE_API_BASE</code> URL).
                          If you use the Vite proxy (empty <code>VITE_API_BASE</code>), set{" "}
                          <code>frontend/.env</code> <code>API_PROXY_TARGET</code> to match and restart{" "}
                          <code>npm run dev</code>. For local dev, <code>VITE_API_BASE=http://127.0.0.1:8010/api/v1</code>{" "}
                          bypasses the proxy (backend <code>CORS_ORIGINS</code> must list this site&apos;s origin).
                        </Alert>
                      ) : null}
                      {info ? <Alert severity="success">{info}</Alert> : null}
                      {error ? <Alert severity="error">{error}</Alert> : null}
                      {!otpStep ? (
                        <>
                          <TextField
                            label="Work Email"
                            type="email"
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
                            error={touched.email && !!emailNorm && !emailValid}
                            helperText={touched.email && !!emailNorm && !emailValid ? "Enter a valid work email address." : " "}
                            required
                            fullWidth
                          />
                          <TextField
                            label="Password"
                            type={showPassword ? "text" : "password"}
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                            onKeyUp={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
                            error={touched.password && !!password && !passwordStrongEnough}
                            helperText={
                              touched.password && !!password && !passwordStrongEnough
                                ? "Use at least 8 characters."
                                : capsLockOn
                                  ? "Caps Lock appears to be on."
                                  : " "
                            }
                            required
                            fullWidth
                            InputProps={{
                              endAdornment: (
                                <InputAdornment position="end">
                                  <IconButton
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    edge="end"
                                  >
                                    {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                  </IconButton>
                                </InputAdornment>
                              )
                            }}
                          />
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={rememberEmail}
                                onChange={(e) => setRememberEmail(e.target.checked)}
                                color="primary"
                              />
                            }
                            label="Remember email on this device"
                            sx={{ "& .MuiFormControlLabel-label": { fontSize: { xs: "0.84rem", md: "0.9rem" } } }}
                          />
                          <Button type="submit" variant="contained" disabled={!canSubmit} size="large" sx={{ py: 1.3 }}>
                            {busy ? "Signing in..." : "Sign in to AI-CSGTS"}
                          </Button>
                          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                            <Button type="button" variant="text" onClick={() => navigate("/register")}>
                              Employee registration
                            </Button>
                            <Typography variant="caption" color="text.secondary">
                              Secure role-based access
                            </Typography>
                          </Stack>
                        </>
                      ) : null}
                    </Stack>
                  </form>

                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>
    </AppShell>
  );
}

