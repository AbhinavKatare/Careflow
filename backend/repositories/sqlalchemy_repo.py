from typing import Optional, List
from sqlalchemy import select
from sqlalchemy.orm import Session
from backend.models.models import (
    Clinic,
    Program,
    DemoPatient,
    CheckIn,
    SubmittedText,
    ReviewCase,
    AuditEvent,
)
from backend.models.enums import CaseStatus
from .interfaces import (
    IClinicRepository,
    IProgramRepository,
    IPatientRepository,
    ICheckInRepository,
    IReviewCaseRepository,
    IAuditEventRepository,
    IUnitOfWork,
)


class SqlAlchemyClinicRepository(IClinicRepository):
    def __init__(self, session: Session):
        self._session = session

    def get_by_code(self, code: str) -> Optional[Clinic]:
        stmt = select(Clinic).where(Clinic.code == code)
        return self._session.scalars(stmt).first()

    def create(self, clinic: Clinic) -> Clinic:
        self._session.add(clinic)
        self._session.flush()
        return clinic

    def list_all(self) -> List[Clinic]:
        return list(self._session.scalars(select(Clinic)).all())


class SqlAlchemyProgramRepository(IProgramRepository):
    def __init__(self, session: Session):
        self._session = session

    def get_by_code(self, code: str) -> Optional[Program]:
        stmt = select(Program).where(Program.code == code)
        return self._session.scalars(stmt).first()

    def create(self, program: Program) -> Program:
        self._session.add(program)
        self._session.flush()
        return program

    def list_all(self) -> List[Program]:
        return list(self._session.scalars(select(Program)).all())


class SqlAlchemyPatientRepository(IPatientRepository):
    def __init__(self, session: Session):
        self._session = session

    def get_by_id(self, id: int) -> Optional[DemoPatient]:
        return self._session.get(DemoPatient, id)

    def get_by_patient_id(self, patient_id: str) -> Optional[DemoPatient]:
        stmt = select(DemoPatient).where(DemoPatient.patient_id == patient_id)
        return self._session.scalars(stmt).first()

    def list_all(self) -> List[DemoPatient]:
        return list(self._session.scalars(select(DemoPatient)).all())

    def create(self, patient: DemoPatient) -> DemoPatient:
        self._session.add(patient)
        self._session.flush()
        return patient

    def count(self) -> int:
        return len(self.list_all())


class SqlAlchemyCheckInRepository(ICheckInRepository):
    def __init__(self, session: Session):
        self._session = session

    def create(self, check_in: CheckIn, raw_note: Optional[str] = None) -> CheckIn:
        self._session.add(check_in)
        self._session.flush()

        if raw_note is not None:
            # Original submitted text stored separately and never mutated
            submitted_text = SubmittedText.create_immutable(
                check_in_id=check_in.id,
                raw_note=raw_note,
            )
            self._session.add(submitted_text)
            self._session.flush()

        return check_in

    def get_by_id(self, id: int) -> Optional[CheckIn]:
        return self._session.get(CheckIn, id)

    def get_submitted_text(self, check_in_id: int) -> Optional[SubmittedText]:
        stmt = select(SubmittedText).where(SubmittedText.check_in_id == check_in_id)
        return self._session.scalars(stmt).first()


class SqlAlchemyReviewCaseRepository(IReviewCaseRepository):
    def __init__(self, session: Session):
        self._session = session

    def create(self, case: ReviewCase) -> ReviewCase:
        self._session.add(case)
        self._session.flush()
        return case

    def get_by_id(self, id: int) -> Optional[ReviewCase]:
        return self._session.get(ReviewCase, id)

    def get_by_check_in_id(self, check_in_id: int) -> Optional[ReviewCase]:
        stmt = select(ReviewCase).where(ReviewCase.check_in_id == check_in_id)
        return self._session.scalars(stmt).first()

    def transition_status(self, case_id: int, target_status: CaseStatus) -> ReviewCase:
        case = self.get_by_id(case_id)
        if not case:
            raise KeyError(f"ReviewCase {case_id} not found")
        case.transition_to(target_status)
        self._session.flush()
        return case

    def list_by_status(self, status: CaseStatus) -> List[ReviewCase]:
        stmt = select(ReviewCase).where(ReviewCase.status == status)
        return list(self._session.scalars(stmt).all())


class SqlAlchemyAuditEventRepository(IAuditEventRepository):
    def __init__(self, session: Session):
        self._session = session

    def append(self, event: AuditEvent) -> AuditEvent:
        self._session.add(event)
        self._session.flush()
        return event

    def list_for_entity(self, entity_type: str, entity_id: str) -> List[AuditEvent]:
        stmt = (
            select(AuditEvent)
            .where(AuditEvent.entity_type == entity_type, AuditEvent.entity_id == entity_id)
            .order_by(AuditEvent.created_at.asc())
        )
        return list(self._session.scalars(stmt).all())


class SqlAlchemyUnitOfWork(IUnitOfWork):
    def __init__(self, session: Session):
        self.session = session
        self.clinics = SqlAlchemyClinicRepository(session)
        self.programs = SqlAlchemyProgramRepository(session)
        self.patients = SqlAlchemyPatientRepository(session)
        self.check_ins = SqlAlchemyCheckInRepository(session)
        self.review_cases = SqlAlchemyReviewCaseRepository(session)
        self.audit_events = SqlAlchemyAuditEventRepository(session)

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()

    def __enter__(self) -> "SqlAlchemyUnitOfWork":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if exc_type is not None:
            self.rollback()
        else:
            self.commit()

