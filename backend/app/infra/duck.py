from contextlib import contextmanager
import duckdb

@contextmanager
def connect_db():
    con = duckdb.connect(database=":memory:")
    try:
        yield con
    finally:
        con.close()
