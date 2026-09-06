use std::path::{Path, PathBuf};

use rusqlite::{Connection, Error, OpenFlags, Result, TransactionBehavior};

const MIGRATIONS: &[&str] = &[include_str!("../migrations/0001_create_clips.sql")];

#[derive(Clone, Debug)]
pub(crate) struct Database {
    path: PathBuf,
}

impl Database {
    pub(crate) fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
    }

    pub(crate) fn open_existing(path: impl AsRef<Path>) -> Result<Self> {
        Self::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
    }

    fn open_with_flags(path: impl AsRef<Path>, flags: OpenFlags) -> Result<Self> {
        let database = Self {
            path: path.as_ref().to_owned(),
        };
        let mut connection = Connection::open_with_flags(&database.path, flags)?;
        apply_migrations(&mut connection)?;
        Ok(database)
    }

    pub(crate) fn connect(&self) -> Result<Connection> {
        Connection::open_with_flags(&self.path, OpenFlags::SQLITE_OPEN_READ_WRITE)
    }
}

fn apply_migrations(connection: &mut Connection) -> Result<()> {
    loop {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current_version: usize = transaction
            .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))?
            .try_into()
            .map_err(|_| Error::InvalidQuery)?;
        if current_version > MIGRATIONS.len() {
            return Err(Error::InvalidQuery);
        }
        let Some(migration) = MIGRATIONS.get(current_version) else {
            transaction.commit()?;
            break;
        };
        let target_version: i64 = (current_version + 1)
            .try_into()
            .map_err(|_| Error::InvalidQuery)?;
        transaction.execute_batch(migration)?;
        transaction.pragma_update(None, "user_version", target_version)?;
        transaction.commit()?;
    }

    Ok(())
}
