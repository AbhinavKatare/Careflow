from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any
from backend.models.models import (
    Clinic,
    Program,
    DemoPatient,
    CheckIn,
    SubmittedText,
    ReviewCase,
    AuditEvent,
    EvaluationRun,
)
from backend.models.enums import CaseStatus


class IClinicRepository(ABC):
    @abstractmethod
    def get_by_code(self, code: str) -> Optional[Clinic]:
        pass

    @abstractmethod
    def create(self, clinic: Clinic) -> Clinic:
        pass

    @abstractmethod
    def list_all(self) -> List[Clinic]:
        pass


class IProgramRepository(ABC):
    @abstractmethod
    def get_by_code(self, code: str) -> Optional[Program]:
        pass

    @abstractmethod
    def create(self, program: Program) -> Program:
        pass

    @abstractmethod
    def list_all(self) -> List[Program]:
        pass


class IPatientRepository(ABC):
    @abstractmethod
    def get_by_id(self, id: int) -> Optional[DemoPatient]:
        pass

    @abstractmethod
    def get_by_patient_id(self, patient_id: str) -> Optional[DemoPatient]:
        pass

    @abstractmethod
    def list_all(self) -> List[DemoPatient]:
        pass

    @abstractmethod
    def create(self, patient: DemoPatient) -> DemoPatient:
        pass

    @abstractmethod
    def count(self) -> int:
        pass


class ICheckInRepository(ABC):
    @abstractmethod
    def create(self, check_in: CheckIn, raw_note: Optional[str] = None) -> CheckIn:
        pass

    @abstractmethod
    def get_by_id(self, id: int) -> Optional[CheckIn]:
        pass

    @abstractmethod
    def get_submitted_text(self, check_in_id: int) -> Optional[SubmittedText]:
        pass


class IReviewCaseRepository(ABC):
    @abstractmethod
    def create(self, case: ReviewCase) -> ReviewCase:
        pass

    @abstractmethod
    def get_by_id(self, id: int) -> Optional[ReviewCase]:
        pass

    @abstractmethod
    def get_by_check_in_id(self, check_in_id: int) -> Optional[ReviewCase]:
        pass

    @abstractmethod
    def transition_status(self, case_id: int, target_status: CaseStatus) -> ReviewCase:
        pass

    @abstractmethod
    def list_by_status(self, status: CaseStatus) -> List[ReviewCase]:
        pass


class IAuditEventRepository(ABC):
    @abstractmethod
    def append(self, event: AuditEvent) -> AuditEvent:
        pass

    @abstractmethod
    def list_for_entity(self, entity_type: str, entity_id: str) -> List[AuditEvent]:
        pass


class IUnitOfWork(ABC):
    clinics: IClinicRepository
    programs: IProgramRepository
    patients: IPatientRepository
    check_ins: ICheckInRepository
    review_cases: IReviewCaseRepository
    audit_events: IAuditEventRepository

    @abstractmethod
    def commit(self) -> None:
        pass

    @abstractmethod
    def rollback(self) -> None:
        pass

    @abstractmethod
    def __enter__(self) -> "IUnitOfWork":
        pass

    @abstractmethod
    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        pass

