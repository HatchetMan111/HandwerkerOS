VERSION = "0001_initial"


def upgrade(engine) -> None:
    from app.backend import models  # noqa: F401
    from app.backend.db import Base

    Base.metadata.create_all(bind=engine)
