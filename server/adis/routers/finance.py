"""Finance: incomes, expenses, debts and the monthly summary."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..core.timeutil import parse_iso
from ..deps import fail, not_found, store
from ..models import Debt, Transaction
from ..schemas import DebtIn, DebtPatch, RepayIn, TransactionIn, TransactionPatch
from ..serialize import debt_out, tx_out
from ..services.finance import Finance
from ..services.store import Store

router = APIRouter()


def _done(s: Store, value):
    s.commit()
    return value


@router.get("/finance/transactions")
def transactions(from_: str | None = Query(None, alias="from"), to: str | None = None, kind: str | None = None, category: str | None = None,
                 s: Store = Depends(store)):
    return [tx_out(t) for t in Finance(s).transactions(parse_iso(from_), parse_iso(to), kind, category)]


@router.post("/finance/transactions")
def add_transaction(body: TransactionIn, s: Store = Depends(store)):
    return _done(s, tx_out(Finance(s).add_transaction(body.model_dump())))


@router.patch("/finance/transactions/{tid}")
def update_transaction(tid: str, body: TransactionPatch, s: Store = Depends(store)):
    return _done(s, tx_out(Finance(s).update_transaction(tid, body.patch()) or not_found()))


@router.delete("/finance/transactions/{tid}")
def delete_transaction(tid: str, s: Store = Depends(store)):
    return _done(s, {"ok": True}) if Finance(s).delete(Transaction, tid) else not_found()


@router.get("/finance/debts")
def debts(status: str | None = None, direction: str | None = None, s: Store = Depends(store)):
    return [debt_out(d) for d in Finance(s).debts(status, direction)]


@router.post("/finance/debts")
def add_debt(body: DebtIn, s: Store = Depends(store)):
    if not body.person_id and not body.counterparty.strip():
        fail(422, "Укажите, кто должен или кому вы должны")
    return _done(s, debt_out(Finance(s).add_debt(body.model_dump())))


@router.patch("/finance/debts/{did}")
def update_debt(did: str, body: DebtPatch, s: Store = Depends(store)):
    return _done(s, debt_out(Finance(s).update_debt(did, body.patch()) or not_found()))


@router.post("/finance/debts/{did}/repay")
def repay(did: str, body: RepayIn, s: Store = Depends(store)):
    return _done(s, debt_out(Finance(s).repay(did, body.amount) or not_found()))


@router.delete("/finance/debts/{did}")
def delete_debt(did: str, s: Store = Depends(store)):
    return _done(s, {"ok": True}) if Finance(s).delete(Debt, did) else not_found()


@router.get("/finance/summary")
def summary(month: str | None = None, s: Store = Depends(store)):
    """month=YYYY-MM in the user's time zone (default: current month)."""
    if month and not (len(month) == 7 and month[4] == "-" and month[:4].isdigit() and 1 <= int(month[5:]) <= 12):
        fail(422, "Месяц в формате ГГГГ-ММ")
    f = Finance(s)
    start, end, _ = f.period(month=month)
    return {"month": start.strftime("%Y-%m"), **f.summary(start, end)}
