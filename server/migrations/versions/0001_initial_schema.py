"""initial schema

Revision ID: 0001
Revises: 
Create Date: 2026-11-19 12:42:22.146122
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('users',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('pass_hash', sa.String(length=255), nullable=False),
    sa.Column('assistant_name', sa.String(length=60), nullable=False),
    sa.Column('avatar', sa.Text(), nullable=True),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('demo', sa.Boolean(), nullable=False),
    sa.Column('calendar_token', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('calendar_token')
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)

    op.create_table('agents',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('instructions', sa.Text(), nullable=False),
    sa.Column('tools', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('icon', sa.String(length=32), nullable=False),
    sa.Column('builtin', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('agents', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_agents_user_id'), ['user_id'], unique=False)

    op.create_table('alarms',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('hour', sa.Integer(), nullable=False),
    sa.Column('minute', sa.Integer(), nullable=False),
    sa.Column('days', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('next_at', sa.DateTime(), nullable=True),
    sa.Column('snooze_until', sa.DateTime(), nullable=True),
    sa.Column('ring_at', sa.DateTime(), nullable=True),
    sa.Column('acked_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('alarms', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_alarms_next_at'), ['next_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_alarms_snooze_until'), ['snooze_until'], unique=False)
        batch_op.create_index(batch_op.f('ix_alarms_user_id'), ['user_id'], unique=False)

    op.create_table('auth_sessions',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('access_hash', sa.String(length=64), nullable=False),
    sa.Column('access_expires', sa.DateTime(), nullable=False),
    sa.Column('refresh_hash', sa.String(length=64), nullable=False),
    sa.Column('refresh_expires', sa.DateTime(), nullable=False),
    sa.Column('device', sa.String(length=120), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('last_active_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('auth_sessions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_auth_sessions_access_hash'), ['access_hash'], unique=True)
        batch_op.create_index(batch_op.f('ix_auth_sessions_refresh_hash'), ['refresh_hash'], unique=True)
        batch_op.create_index(batch_op.f('ix_auth_sessions_user_id'), ['user_id'], unique=False)

    op.create_table('conversations',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_conversations_user_id'), ['user_id'], unique=False)

    op.create_table('documents',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('documents', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_documents_user_id'), ['user_id'], unique=False)

    op.create_table('people',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('photo', sa.Text(), nullable=True),
    sa.Column('profession', sa.String(length=160), nullable=False),
    sa.Column('skills', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('organization', sa.String(length=160), nullable=False),
    sa.Column('met_at', sa.DateTime(), nullable=True),
    sa.Column('met_where', sa.String(length=255), nullable=False),
    sa.Column('notes', sa.Text(), nullable=False),
    sa.Column('interactions', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('people', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_people_user_id'), ['user_id'], unique=False)

    op.create_table('push_subscriptions',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('endpoint', sa.Text(), nullable=False),
    sa.Column('endpoint_hash', sa.String(length=64), nullable=False),
    sa.Column('p256dh', sa.String(length=255), nullable=False),
    sa.Column('auth', sa.String(length=255), nullable=False),
    sa.Column('device', sa.String(length=120), nullable=False),
    sa.Column('failures', sa.Integer(), nullable=False),
    sa.Column('last_ok_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('push_subscriptions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_push_subscriptions_endpoint_hash'), ['endpoint_hash'], unique=True)
        batch_op.create_index(batch_op.f('ix_push_subscriptions_user_id'), ['user_id'], unique=False)

    op.create_table('suggestion_state',
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('suggestion_id', sa.String(length=120), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('until', sa.DateTime(), nullable=True),
    sa.Column('at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'suggestion_id')
    )
    op.create_table('agent_runs',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('agent_id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('steps', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('result', sa.Text(), nullable=False),
    sa.Column('started_at', sa.DateTime(), nullable=False),
    sa.Column('finished_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('agent_runs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_agent_runs_agent_id'), ['agent_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_agent_runs_user_id'), ['user_id'], unique=False)

    op.create_table('events',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('start_at', sa.DateTime(), nullable=False),
    sa.Column('end_at', sa.DateTime(), nullable=True),
    sa.Column('location', sa.String(length=255), nullable=False),
    sa.Column('notes', sa.Text(), nullable=False),
    sa.Column('remind_minutes', sa.Integer(), nullable=False),
    sa.Column('person_id', sa.String(length=40), nullable=True),
    sa.Column('notified_start', sa.DateTime(), nullable=True),
    sa.Column('external_uid', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['person_id'], ['people.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('events', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_events_external_uid'), ['external_uid'], unique=False)
        batch_op.create_index(batch_op.f('ix_events_start_at'), ['start_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_events_user_id'), ['user_id'], unique=False)

    op.create_table('memories',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('type', sa.String(length=24), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('tags', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('confirmed', sa.Boolean(), nullable=False),
    sa.Column('person_id', sa.String(length=40), nullable=True),
    sa.Column('source', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('photo', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['person_id'], ['people.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('memories', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_memories_person_id'), ['person_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_memories_type'), ['type'], unique=False)
        batch_op.create_index(batch_op.f('ix_memories_user_id'), ['user_id'], unique=False)

    op.create_table('messages',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('conversation_id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('pos', sa.Integer(), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('attachments', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('cards', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('tool_calls', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('client_message_id', sa.String(length=80), nullable=True),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('engine', sa.String(length=80), nullable=True),
    sa.Column('stopped', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('conversation_id', 'client_message_id')
    )
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_messages_conversation_id'), ['conversation_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_messages_user_id'), ['user_id'], unique=False)

    op.create_table('tasks',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('notes', sa.Text(), nullable=False),
    sa.Column('due_at', sa.DateTime(), nullable=True),
    sa.Column('repeat', sa.String(length=16), nullable=False),
    sa.Column('remind', sa.Boolean(), nullable=False),
    sa.Column('done', sa.Boolean(), nullable=False),
    sa.Column('done_at', sa.DateTime(), nullable=True),
    sa.Column('person_id', sa.String(length=40), nullable=True),
    sa.Column('notify_at', sa.DateTime(), nullable=True),
    sa.Column('notified_at', sa.DateTime(), nullable=True),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('source', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['person_id'], ['people.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_tasks_due_at'), ['due_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_notify_at'), ['notify_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_user_id'), ['user_id'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_tasks_user_id'))
        batch_op.drop_index(batch_op.f('ix_tasks_notify_at'))
        batch_op.drop_index(batch_op.f('ix_tasks_due_at'))

    op.drop_table('tasks')
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_messages_user_id'))
        batch_op.drop_index(batch_op.f('ix_messages_conversation_id'))

    op.drop_table('messages')
    with op.batch_alter_table('memories', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_memories_user_id'))
        batch_op.drop_index(batch_op.f('ix_memories_type'))
        batch_op.drop_index(batch_op.f('ix_memories_person_id'))

    op.drop_table('memories')
    with op.batch_alter_table('events', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_events_user_id'))
        batch_op.drop_index(batch_op.f('ix_events_start_at'))
        batch_op.drop_index(batch_op.f('ix_events_external_uid'))

    op.drop_table('events')
    with op.batch_alter_table('agent_runs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_agent_runs_user_id'))
        batch_op.drop_index(batch_op.f('ix_agent_runs_agent_id'))

    op.drop_table('agent_runs')
    op.drop_table('suggestion_state')
    with op.batch_alter_table('push_subscriptions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_push_subscriptions_user_id'))
        batch_op.drop_index(batch_op.f('ix_push_subscriptions_endpoint_hash'))

    op.drop_table('push_subscriptions')
    with op.batch_alter_table('people', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_people_user_id'))

    op.drop_table('people')
    with op.batch_alter_table('documents', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_documents_user_id'))

    op.drop_table('documents')
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_conversations_user_id'))

    op.drop_table('conversations')
    with op.batch_alter_table('auth_sessions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_auth_sessions_user_id'))
        batch_op.drop_index(batch_op.f('ix_auth_sessions_refresh_hash'))
        batch_op.drop_index(batch_op.f('ix_auth_sessions_access_hash'))

    op.drop_table('auth_sessions')
    with op.batch_alter_table('alarms', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_alarms_user_id'))
        batch_op.drop_index(batch_op.f('ix_alarms_snooze_until'))
        batch_op.drop_index(batch_op.f('ix_alarms_next_at'))

    op.drop_table('alarms')
    with op.batch_alter_table('agents', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_agents_user_id'))

    op.drop_table('agents')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_email'))

    op.drop_table('users')
