import React, { useEffect, useMemo, useState } from "react";
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
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api } from "../api/client";
import { setAuth } from "../auth/authStore";
import { dashboardPathForRole } from "../auth/roleRouting";
import { getApiErrorMessage } from "../utils/apiError";

export default function LoginPage() {
  const theme = useTheme();
  const isSmall = useMediaQuery(theme.breakpoints.down("sm"));
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
  const [otpCode, setOtpCode] = useState("");
  const [otpRequestId, setOtpRequestId] = useState("");
  const [otpStep, setOtpStep] = useState(false);
  const [resendInSeconds, setResendInSeconds] = useState(0);

  useEffect(() => {
    const savedEmail = window.localStorage.getItem("aicsgts_last_email");
    if (savedEmail) setEmail(savedEmail);
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
      const msg = getApiErrorMessage(err, "Login failed");
      const extra =
        err?.response?.status === 401
          ? " Confirm email/password. Start the API (uvicorn) and match the Vite proxy port in vite.config.js (often 8010 or 8888). Pending employees see 403 until approved."
          : "";
      setError(msg + extra);
    } finally {
      setBusy(false);
    }
  }

  async function doVerifyOtp() {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      const res = await api.post("/auth/verify-otp", {
        email: emailNorm,
        otp_request_id: otpRequestId,
        otp_code: otpCode.trim()
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

  function onSubmit(e) {
    e.preventDefault();
    if (otpStep) {
      if (otpCode.trim().length !== 6 || !otpRequestId) {
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
                      {info && !otpStep ? <Alert severity="success">{info}</Alert> : null}
                      {error ? <Alert severity="error">{error}</Alert> : null}
                      {otpStep ? (
                        <>
                          <Box
                            sx={{
                              p: { xs: 1.4, sm: 1.8 },
                              borderRadius: 2.5,
                              border: "1px solid",
                              borderColor: "divider",
                              bgcolor: "action.hover"
                            }}
                          >
                            <Stack spacing={0.7}>
                              <Typography variant="subtitle1" fontWeight={800}>
                                OTP Verification
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                A 6-digit verification code was sent to <b>{emailNorm}</b>.
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                Enter the code below to continue to your secure AI-CSGTS workspace.
                              </Typography>
                            </Stack>
                          </Box>
                          <TextField
                            label="One-Time Password (OTP)"
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                            inputProps={{ inputMode: "numeric", pattern: "[0-9]*", maxLength: 6 }}
                            fullWidth
                            required
                          />
                          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.1}>
                            <Button
                              type="button"
                              variant="contained"
                              fullWidth={isSmall}
                              disabled={busy || otpCode.trim().length !== 6}
                              onClick={() => void doVerifyOtp()}
                            >
                              {busy ? "Verifying..." : "Verify OTP"}
                            </Button>
                            <Button
                              type="button"
                              variant="outlined"
                              fullWidth={isSmall}
                              disabled={busy || resendInSeconds > 0}
                              onClick={() => void doResendOtp()}
                            >
                              {resendInSeconds > 0 ? `Resend OTP in ${resendInSeconds}s` : "Resend OTP"}
                            </Button>
                            <Button
                              type="button"
                              variant="text"
                              fullWidth={isSmall}
                              onClick={() => {
                                setOtpStep(false);
                                setOtpCode("");
                                setOtpRequestId("");
                                setResendInSeconds(0);
                                setInfo("");
                              }}
                            >
                              Back to password
                            </Button>
                          </Stack>
                        </>
                      ) : null}
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

