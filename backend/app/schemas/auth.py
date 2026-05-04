from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class LoginResponse(BaseModel):
    access_token: str | None = None
    token_type: str = "bearer"
    role: str | None = None
    must_change_password: bool | None = None
    requires_otp: bool = False
    otp_request_id: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    must_change_password: bool


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=200)


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp_request_id: str = Field(min_length=30, max_length=100)
    otp_code: str = Field(min_length=6, max_length=6)


class ResendOtpRequest(BaseModel):
    email: EmailStr
    otp_request_id: str = Field(min_length=30, max_length=100)


class ResendOtpResponse(BaseModel):
    requires_otp: bool = True
    otp_request_id: str
    resend_cooldown_seconds: int


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=6, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)
