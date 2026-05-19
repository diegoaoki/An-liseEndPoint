import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()

# Railway expõe DATABASE_URL automaticamente quando o plugin Postgres é adicionado.
# Sem Postgres (dev local) cai para SQLite num arquivo local.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./local.db")

# Railway/Heroku às vezes entregam o prefixo legado "postgres://"
# que o SQLAlchemy 2.x não aceita; normaliza para "postgresql://".
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
