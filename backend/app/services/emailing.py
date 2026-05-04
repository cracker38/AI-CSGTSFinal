from __future__ import annotations

import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from app.core.config import settings


def send_login_otp_email(*, to_email: str, otp_code: str) -> None:
    if not settings.smtp_host:
        raise RuntimeError("SMTP is not configured. Set SMTP_HOST and related variables in backend/.env.")
    if not settings.smtp_from_email:
        raise RuntimeError("SMTP_FROM_EMAIL is required for OTP delivery.")
    if settings.smtp_use_ssl and settings.smtp_use_tls:
        raise RuntimeError("Choose one SMTP mode: either SMTP_USE_SSL=true or SMTP_USE_TLS=true, not both.")

    msg = EmailMessage()
    msg["Subject"] = "Your AI-CSGTS Login OTP Code"
    msg["From"] = formataddr(("AI-CSGTS", settings.smtp_from_email))
    msg["To"] = to_email
    msg.set_content(
        "\n".join(
            [
                "AI-CSGTS Secure Login Verification",
                "",
                "Hello,",
                "",
                "Use the one-time password (OTP) below to complete your sign-in:",
                f"OTP: {otp_code}",
                "",
                f"This code expires in {settings.otp_expire_minutes} minutes.",
                "For your security, never share this code with anyone.",
                "",
                "If you did not request this login, ignore this email and reset your account password.",
                "",
                "AI-CSGTS Security Team",
            ]
        )
    )
    msg.add_alternative(
        f"""\
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI-CSGTS Login OTP</title>
  </head>
  <body style="margin:0;padding:0;background:#eef3fb;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#17212f;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dfe7f2;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(16,45,99,0.10);">
            <tr>
              <td style="padding:22px 24px;background:linear-gradient(135deg,#0b2f7a,#1565c0,#2f80ed);color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.1em;opacity:0.95;">AI-CSGTS SECURITY</div>
                <div style="font-size:24px;font-weight:700;margin-top:4px;">Your Login Verification Code</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
                  Use the code below to complete your sign-in to
                  <strong>AI-Powered Competency &amp; Skill Gap Tracking System</strong>.
                </p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:14px 0 18px;">
                  <tr>
                    <td align="center" style="background:#f3f8ff;border:1px dashed #8ab4f8;border-radius:14px;padding:16px;">
                      <div style="font-size:13px;color:#43638b;margin-bottom:6px;">One-Time Password (OTP)</div>
                      <div style="font-size:36px;letter-spacing:9px;font-weight:800;color:#0d47a1;">{otp_code}</div>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:14px;line-height:1.6;">
                  This code expires in <strong>{settings.otp_expire_minutes} minutes</strong>.
                </p>
                <p style="margin:0 0 14px;font-size:14px;line-height:1.6;">
                  For your security, do not share this code with anyone.
                </p>
                <div style="background:#fff7e6;border:1px solid #ffd591;border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.6;color:#7a4b00;">
                  If you did not attempt to sign in, ignore this email and consider changing your password.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e6edf5;font-size:12px;color:#60708a;">
                Sent by AI-CSGTS authentication service · This is an automated security email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
""",
        subtype="html",
    )

    if settings.smtp_use_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds) as server:
            if settings.smtp_username:
                server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(msg)
        return

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds) as server:
        if settings.smtp_use_tls:
            server.ehlo()
            server.starttls()
            server.ehlo()
        if settings.smtp_username:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(msg)
