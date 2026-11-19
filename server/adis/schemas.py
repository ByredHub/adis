"""Request bodies (validated). camelCase on the wire, snake_case in Python. Unknown fields are ignored."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Repeat = Literal["none", "daily", "weekly", "monthly"]
PHOTO_MAX = 2_000_000


class In(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    def patch(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True)


# ---------- auth ----------
class RegisterIn(In):
    name: str = ""
    email: str = ""
    password: str = ""


class LoginIn(In):
    email: str = ""
    password: str = ""
    demo: bool = False


class RefreshIn(In):
    refresh_token: str = ""


class LogoutIn(In):
    refresh_token: str | None = None


class ForgotIn(In):
    email: str = ""


class ChangePasswordIn(In):
    current: str = ""
    next: str = ""


class UserPatch(In):
    name: str | None = Field(None, max_length=120)
    assistant_name: str | None = Field(None, max_length=60)
    avatar: str | None = Field(None, max_length=PHOTO_MAX)


# ---------- chat ----------
class AttachmentIn(In):
    name: str = Field("", max_length=255)
    size: int = 0
    type: str = Field("", max_length=120)
    text: str | None = Field(None, max_length=200_000)
    image: str | None = Field(None, max_length=1_500_000)
    width: int | None = None
    height: int | None = None


class ChatIn(In):
    conversation_id: str | None = None
    content: str = ""
    attachments: list[AttachmentIn] = Field(default_factory=list, max_length=5)
    client_message_id: str | None = Field(None, max_length=80)
    source: Literal["text", "voice"] = "text"
    regenerate: bool = False
    auto_save: bool = False
    sensitive_guard: bool = True


class CardPatch(In):
    status: Literal["pending", "confirmed", "dismissed", "info"] | None = None
    result: dict | None = None
    data: dict | None = None


# ---------- memory / people ----------
class MemoryIn(In):
    type: str = "fact"
    title: str = Field("", max_length=255)
    content: str = Field("", max_length=20_000)
    tags: list[str] = Field(default_factory=list, max_length=30)
    confirmed: bool = True
    person_id: str | None = None
    source: dict | None = None
    photo: str | None = Field(None, max_length=PHOTO_MAX)


class MemoryPatch(In):
    type: str | None = None
    title: str | None = Field(None, max_length=255)
    content: str | None = Field(None, max_length=20_000)
    tags: list[str] | None = Field(None, max_length=30)
    confirmed: bool | None = None
    person_id: str | None = None
    photo: str | None = Field(None, max_length=PHOTO_MAX)


class PersonIn(In):
    id: str | None = None
    name: str | None = Field(None, max_length=160)
    photo: str | None = Field(None, max_length=PHOTO_MAX)
    profession: str | None = Field(None, max_length=160)
    skills: list[str] | None = Field(None, max_length=50)
    organization: str | None = Field(None, max_length=160)
    met_at: datetime | None = None
    met_where: str | None = Field(None, max_length=255)
    notes: str | None = Field(None, max_length=20_000)
    interaction: str | None = Field(None, max_length=2_000)


class PersonPatch(In):
    name: str | None = Field(None, max_length=160)
    photo: str | None = Field(None, max_length=PHOTO_MAX)
    profession: str | None = Field(None, max_length=160)
    skills: list[str] | None = Field(None, max_length=50)
    organization: str | None = Field(None, max_length=160)
    met_at: datetime | None = None
    met_where: str | None = Field(None, max_length=255)
    notes: str | None = Field(None, max_length=20_000)
    interactions: list[dict] | None = None


# ---------- tasks / events / documents ----------
class TaskIn(In):
    title: str = Field("", max_length=255)
    notes: str = Field("", max_length=20_000)
    due_at: datetime | None = None
    repeat: Repeat = "none"
    remind: bool = True
    person_id: str | None = None
    timezone: str | None = Field(None, max_length=64)
    source: dict | None = None


class TaskPatch(In):
    title: str | None = Field(None, max_length=255)
    notes: str | None = Field(None, max_length=20_000)
    due_at: datetime | None = None
    repeat: Repeat | None = None
    remind: bool | None = None
    done: bool | None = None
    person_id: str | None = None


class EventIn(In):
    title: str = Field("", max_length=255)
    start_at: datetime | None = None
    end_at: datetime | None = None
    location: str = Field("", max_length=255)
    notes: str = Field("", max_length=20_000)
    remind_minutes: int = 15
    person_id: str | None = None


class EventPatch(In):
    title: str | None = Field(None, max_length=255)
    start_at: datetime | None = None
    end_at: datetime | None = None
    location: str | None = Field(None, max_length=255)
    notes: str | None = Field(None, max_length=20_000)
    remind_minutes: int | None = None
    person_id: str | None = None


class AlarmIn(In):
    hour: int = Field(..., ge=0, le=23)
    minute: int = Field(0, ge=0, le=59)
    days: list[int] = Field(default_factory=list, max_length=7)
    label: str = Field("", max_length=120)
    enabled: bool = True
    timezone: str | None = Field(None, max_length=64)


class AlarmPatch(In):
    hour: int | None = Field(None, ge=0, le=23)
    minute: int | None = Field(None, ge=0, le=59)
    days: list[int] | None = Field(None, max_length=7)
    label: str | None = Field(None, max_length=120)
    enabled: bool | None = None


class SnoozeMinutesIn(In):
    minutes: int = Field(10, ge=1, le=120)


class PushKeys(In):
    p256dh: str = Field(..., max_length=255)
    auth: str = Field(..., max_length=255)


class PushSubscriptionIn(In):
    endpoint: str = Field(..., max_length=2000)
    keys: PushKeys


class PushUnsubscribeIn(In):
    endpoint: str = Field(..., max_length=2000)


class IcsImportIn(In):
    ics: str = Field(..., max_length=3_000_000)


class DocumentIn(In):
    title: str | None = Field(None, max_length=255)
    content: str | None = Field(None, max_length=500_000)


class SnoozeIn(In):
    hours: float = 24


class AgentIn(In):
    name: str | None = Field(None, max_length=120)
    description: str | None = Field(None, max_length=2_000)
    instructions: str | None = Field(None, max_length=10_000)
    tools: list[str] | None = None
