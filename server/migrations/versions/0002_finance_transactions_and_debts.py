"""finance transactions and debts

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-19 14:07:12.236061
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('debts',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('direction', sa.String(length=10), nullable=False),
    sa.Column('person_id', sa.String(length=40), nullable=True),
    sa.Column('counterparty', sa.String(length=160), nullable=False),
    sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('paid', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('note', sa.String(length=500), nullable=False),
    sa.Column('occurred_at', sa.DateTime(), nullable=False),
    sa.Column('due_at', sa.DateTime(), nullable=True),
    sa.Column('remind', sa.Boolean(), nullable=False),
    sa.Column('notified_at', sa.DateTime(), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('closed_at', sa.DateTime(), nullable=True),
    sa.Column('payments', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['person_id'], ['people.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_debts_direction'), 'debts', ['direction'], unique=False)
    op.create_index(op.f('ix_debts_due_at'), 'debts', ['due_at'], unique=False)
    op.create_index(op.f('ix_debts_status'), 'debts', ['status'], unique=False)
    op.create_index(op.f('ix_debts_user_id'), 'debts', ['user_id'], unique=False)
    op.create_table('transactions',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.String(length=40), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('category', sa.String(length=60), nullable=False),
    sa.Column('note', sa.String(length=500), nullable=False),
    sa.Column('occurred_at', sa.DateTime(), nullable=False),
    sa.Column('person_id', sa.String(length=40), nullable=True),
    sa.Column('source', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['person_id'], ['people.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_transactions_kind'), 'transactions', ['kind'], unique=False)
    op.create_index(op.f('ix_transactions_occurred_at'), 'transactions', ['occurred_at'], unique=False)
    op.create_index(op.f('ix_transactions_user_id'), 'transactions', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_transactions_user_id'), table_name='transactions')
    op.drop_index(op.f('ix_transactions_occurred_at'), table_name='transactions')
    op.drop_index(op.f('ix_transactions_kind'), table_name='transactions')
    op.drop_table('transactions')
    op.drop_index(op.f('ix_debts_user_id'), table_name='debts')
    op.drop_index(op.f('ix_debts_status'), table_name='debts')
    op.drop_index(op.f('ix_debts_due_at'), table_name='debts')
    op.drop_index(op.f('ix_debts_direction'), table_name='debts')
    op.drop_table('debts')
