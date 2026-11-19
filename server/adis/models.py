"""ORM models. Every row belongs to a user; all queries are scoped by user_id (permission boundary for AI tools)."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .core.timeutil import utcnow
from .db import Base

# JSONB on PostgreSQL (indexable), plain JSON on SQLite
JSONType = JSON().with_variant(JSONB(), "postgresql")


def _id() -> Mapped[str]:
    return mapped_column(String(40), primary_key=True)


def _owner() -> Mapped[str]:
    return mapped_column(String(40), ForeignKey("users.id", ondelete="CASCADE"), index=True)


def _ts() -> Mapped[datetime]:
    return mapped_column(DateTime, default=utcnow)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = _id()
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    pass_hash: Mapped[str] = mapped_column(String(255))
    assistant_name: Mapped[str] = mapped_column(String(60), default="Adis")
    avatar: Mapped[str | None] = mapped_column(Text, nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    demo: Mapped[bool] = mapped_column(Boolean, default=False)
    # Secret for the read-only iCal subscription URL (phone calendars poll it without a login)
    calendar_token: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    created_at: Mapped[datetime] = _ts()


class AuthSession(Base):
    """One row per signed-in device. Only SHA-256 hashes of tokens are stored."""
    __tablename__ = "auth_sessions"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _owner()
    access_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    access_expires: Mapped[datetime] = mapped_column(DateTime)
    refresh_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    refresh_expires: Mapped[datetime] = mapped_column(DateTime)
    device: Mapped[str] = mapped_column(String(120), default="Устройство")
    created_at: Mapped[datetime] = _ts()
    last_active_at: Mapped[datetime] = _ts()


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _owner()
    title: Mapped[str] = mapped_column(String(120), default="Новый чат")
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts()


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (UniqueConstraint("conversation_id", "client_message_id"),)
    id: Mapped[str] = _id()
    conversation_id: Mapped[str] = mapped_column(String(40), ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = _owner()
    pos: Mapped[int] = mapped_column(Integer, default=0)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text, default="")
    attachments: Mapped[list] = mapped_column(JSONType, default=list)
    cards: Mapped[list] = mapped_column(JSONType, default=list)
    tool_calls: Mapped[list] = mapped_column(JSONType, default=list)
    client_message_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="text")
    engine: Mapped[str | None] = mapped_column(String(80), nullable=True)
    stopped: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = _ts()


class Person(Base):
    __tablename__ = "people"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _owner()
    name: Mapped[str] = mapped_column(String(160))
    photo: Mapped[str | None] = mapped_column(Text, nullable=True)
    profession: Mapped[str] = mapped_column(String(160), default="")
    skills: Mapped[list] = mapped_column(JSONType, default=list)
    organization: Mapped[str] = mapped_column(String(160), default="")
    met_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    met_where: Mapped[str] = mapped_column(String(255), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    interactions: Mapped[list] = mapped_column(JSONType, default=list)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts()


class Memory(Base):
    __tablename__ = "memories"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _owner()
    type: Mapped[str] = mapped_column(String(24), default="fact", index=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSONType, default=list)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=True)
    person_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("people.id", ondelete="SET NULL"), nullable=True, index=True)
    source: Mapped[dict] = mapped_column(JSONType, default=dict)
    photo: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts()


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _owner()
    title: Mapped[str] = mapped_column(String(255))
    notes: Mapped[str] = mapped_column(Text, default="")
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    repeat: Mapped[str] = mapped_column(String(16), default="none")
    remind: Mapped[bool] = mapped_column(Boolean, default=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    person_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("people.id", ondelete="SET NULL"), nullable=True)
    # Server-side reminder queue: a worker picks rows with notify_at <= now and not notified_at (push delivery)
    notify_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    source: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts()


class Event(Base):
    __tablename__ = "events"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _owner()
    title: Mapped[str] = mapped_column(String(255))
    start_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    location: Mapped[str] = mapped_column(String(255), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    remind_minutes: Mapped[int] = mapped_column(Integer, default=15)
    person_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("people.id", ondelete="SET NULL"), nullable=True)
    # start_at value the reminder push was sent for (re-sent if the event is moved)
    notified_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # iCal UID for imported events (dedupe on re-import)
    external_uid: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts()


class Alarm(Base):
    """Alarm clock. `days` uses JS weekday numbers (0 = Sunday); empty = one-time alarm.
    The worker fires it at min(next_at, snooze_until): sets ring_at, sends push, schedules the next occurrence."""
    __tablename__ = "alarms"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _owner()
    hour: Mapped[int] = mapped_column(Integer)
    minute: Mapped[int] = mapped_column(Integer, default=0)
    days: Mapped[list] = mapped_column(JSONType, default=list)
    label: Mapped[str] = mapped_column(String(120), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    next_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    snooze_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    ring_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    acked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts()


class PushSubscription(Base):
    """Web Push subscription of one browser / installed PWA (works on Android and on iOS 16.4+ home-screen apps)."""
    __tablename__ = "push_subscriptions"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _owner()
    endpoint: Mapped[str] = mapped_column(Text)
    endpoint_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    device: Mapped[str] = mapped_column(String(120), default="")
    failures: Mapped[int] = mapped_column(Integer, default=0)
    last_ok_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = _ts()


class Transaction(Base):
    """Income or expense. Amounts are exact decimals in the record's currency."""
    __tablename__ = "transactions"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _owner()
    kind: Mapped[str] = mapped_column(String(10), index=True)  # expense | income
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="RUB")
    category: Mapped[str] = mapped_column(String(60), default="Другое")
    note: Mapped[str] = mapped_column(String(500), default="")
    occurred_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    person_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("people.id", ondelete="SET NULL"), nullable=True)
    source: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts()


class Debt(Base):
    """lent = someone owes me; borrowed = I owe someone. Repayments are kept in `payments`."""
    __tablename__ = "debts"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _owner()
    direction: Mapped[str] = mapped_column(String(10), index=True)  # lent | borrowed
    person_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("people.id", ondelete="SET NULL"), nullable=True)
    counterparty: Mapped[str] = mapped_column(String(160), default="")
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    paid: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    currency: Mapped[str] = mapped_column(String(3), default="RUB")
    note: Mapped[str] = mapped_column(String(500), default="")
    occurred_at: Mapped[datetime] = _ts()
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    remind: Mapped[bool] = mapped_column(Boolean, default=True)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="open", index=True)  # open | closed
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    payments: Mapped[list] = mapped_column(JSONType, default=list)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts()


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _owner()
    title: Mapped[str] = mapped_column(String(255), default="Без названия")
    content: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts()


class SuggestionState(Base):
    __tablename__ = "suggestion_state"
    user_id: Mapped[str] = mapped_column(String(40), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    suggestion_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    status: Mapped[str] = mapped_column(String(16))
    until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    at: Mapped[datetime] = _ts()


class Agent(Base):
    __tablename__ = "agents"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _owner()
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    tools: Mapped[list] = mapped_column(JSONType, default=list)
    icon: Mapped[str] = mapped_column(String(32), default="bot")
    builtin: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = _ts()


class AgentRun(Base):
    __tablename__ = "agent_runs"
    id: Mapped[str] = _id()
    agent_id: Mapped[str] = mapped_column(String(40), ForeignKey("agents.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = _owner()
    status: Mapped[str] = mapped_column(String(16), default="completed")
    steps: Mapped[list] = mapped_column(JSONType, default=list)
    result: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime] = _ts()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
