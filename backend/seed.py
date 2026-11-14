from typing import Dict, Any
from sqlalchemy.orm import Session
from backend.models.models import Clinic, Program, DemoPatient
from backend.repositories.sqlalchemy_repo import SqlAlchemyUnitOfWork


SEED_CLINICS = [
    {
        "code": "CLINIC-DEMO-EAST",
        "name": "Demo Metro Clinic",
    },
    {
        "code": "CLINIC-DEMO-WEST",
        "name": "Demo Valley Health",
    },
]

SEED_PROGRAMS = [
    {
        "clinic_code": "CLINIC-DEMO-EAST",
        "code": "PROG-WEEKLY",
        "name": "Weekly Check-In Routine",
        "description": "Synthetic weekly check-in program for fictional portfolio demo.",
    },
    {
        "clinic_code": "CLINIC-DEMO-WEST",
        "code": "PROG-SUPPORT",
        "name": "Between-Visit Support",
        "description": "Synthetic between-visit support program for fictional portfolio demo.",
    },
]

SEED_PATIENTS = [
    # 6 patients for Clinic East (Weekly)
    {"patient_id": "DEMO-P001", "full_name": "Demo Patient 001", "initials": "DP1", "clinic_code": "CLINIC-DEMO-EAST", "program_code": "PROG-WEEKLY"},
    {"patient_id": "DEMO-P002", "full_name": "Demo Patient 002", "initials": "DP2", "clinic_code": "CLINIC-DEMO-EAST", "program_code": "PROG-WEEKLY"},
    {"patient_id": "DEMO-P003", "full_name": "Demo Patient 003", "initials": "DP3", "clinic_code": "CLINIC-DEMO-EAST", "program_code": "PROG-WEEKLY"},
    {"patient_id": "DEMO-P004", "full_name": "Demo Patient 004", "initials": "DP4", "clinic_code": "CLINIC-DEMO-EAST", "program_code": "PROG-WEEKLY"},
    {"patient_id": "DEMO-P005", "full_name": "Demo Patient 005", "initials": "DP5", "clinic_code": "CLINIC-DEMO-EAST", "program_code": "PROG-WEEKLY"},
    {"patient_id": "DEMO-P006", "full_name": "Demo Patient 006", "initials": "DP6", "clinic_code": "CLINIC-DEMO-EAST", "program_code": "PROG-WEEKLY"},
    # 6 patients for Clinic West (Support)
    {"patient_id": "DEMO-P007", "full_name": "Demo Patient 007", "initials": "DP7", "clinic_code": "CLINIC-DEMO-WEST", "program_code": "PROG-SUPPORT"},
    {"patient_id": "DEMO-P008", "full_name": "Demo Patient 008", "initials": "DP8", "clinic_code": "CLINIC-DEMO-WEST", "program_code": "PROG-SUPPORT"},
    {"patient_id": "DEMO-P009", "full_name": "Demo Patient 009", "initials": "DP9", "clinic_code": "CLINIC-DEMO-WEST", "program_code": "PROG-SUPPORT"},
    {"patient_id": "DEMO-P010", "full_name": "Demo Patient 010", "initials": "P10", "clinic_code": "CLINIC-DEMO-WEST", "program_code": "PROG-SUPPORT"},
    {"patient_id": "DEMO-P011", "full_name": "Demo Patient 011", "initials": "P11", "clinic_code": "CLINIC-DEMO-WEST", "program_code": "PROG-SUPPORT"},
    {"patient_id": "DEMO-P012", "full_name": "Demo Patient 012", "initials": "P12", "clinic_code": "CLINIC-DEMO-WEST", "program_code": "PROG-SUPPORT"},
]


def seed_fictional_data(session: Session) -> Dict[str, Any]:
    """
    Seeds 12 fictional patients across 2 fictional clinics idempotently.
    Safe to execute repeatedly without duplicating data.
    """
    uow = SqlAlchemyUnitOfWork(session)
    clinics_created = 0
    programs_created = 0
    patients_created = 0

    with uow:
        # 1. Seed Clinics
        clinic_map: Dict[str, Clinic] = {}
        for c_def in SEED_CLINICS:
            existing = uow.clinics.get_by_code(c_def["code"])
            if not existing:
                clinic = Clinic(code=c_def["code"], name=c_def["name"])
                existing = uow.clinics.create(clinic)
                clinics_created += 1
            clinic_map[c_def["code"]] = existing

        # 2. Seed Programs
        program_map: Dict[str, Program] = {}
        for p_def in SEED_PROGRAMS:
            existing = uow.programs.get_by_code(p_def["code"])
            clinic = clinic_map[p_def["clinic_code"]]
            if not existing:
                program = Program(
                    clinic_id=clinic.id,
                    code=p_def["code"],
                    name=p_def["name"],
                    description=p_def["description"],
                    is_active=True,
                )
                existing = uow.programs.create(program)
                programs_created += 1
            program_map[p_def["code"]] = existing

        # 3. Seed Patients
        for pat_def in SEED_PATIENTS:
            existing = uow.patients.get_by_patient_id(pat_def["patient_id"])
            if not existing:
                clinic = clinic_map[pat_def["clinic_code"]]
                program = program_map[pat_def["program_code"]]
                patient = DemoPatient(
                    patient_id=pat_def["patient_id"],
                    full_name=pat_def["full_name"],
                    initials=pat_def["initials"],
                    clinic_id=clinic.id,
                    program_id=program.id,
                )
                uow.patients.create(patient)
                patients_created += 1

    return {
        "clinics_created": clinics_created,
        "programs_created": programs_created,
        "patients_created": patients_created,
        "total_clinics": len(uow.clinics.list_all()),
        "total_programs": len(uow.programs.list_all()),
        "total_patients": uow.patients.count(),
    }


if __name__ == "__main__":
    import os
    from sqlalchemy import create_engine

    db_url = os.environ.get("DATABASE_URL", "sqlite:///./careflow.db")
    engine = create_engine(db_url)
    with Session(engine) as session:
        result = seed_fictional_data(session)
        print("Seed completed:")
        for k, v in result.items():
            print(f"  {k}: {v}")


