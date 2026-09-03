use std::path::{Path, PathBuf};

use rusqlite::{Connection, Error, Result, TransactionBehavior};

const MIGRATIONS: &[&str] = &[include_str!("../migrations/0001_create_clips.sql")];

#[derive(Clone, Debug)]
pub(crate) struct Database {
    path: PathBuf,
}

impl Database {
    pub(crate) fn open(path: impl AsRef<Path>) -> Result<Self> {
        let database = Self {
            path: path.as_ref().to_owned(),
        };
        let mut connection = database.connect()?;
        apply_migrations(&mut connection)?;
        Ok(database)
    }

    pub(crate) fn connect(&self) -> Result<Connection> {
        Connection::open(&self.path)
    }
}

fn apply_migrations(connection: &mut Connection) -> Result<()> {
    let current_version: usize = connection
        .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))?
        .try_into()
        .map_err(|_| Error::InvalidQuery)?;

    if current_version > MIGRATIONS.len() {
        return Err(Error::InvalidQuery);
    }

    for (migration_index, migration) in MIGRATIONS.iter().enumerate().skip(current_version) {
        let target_version: i64 = (migration_index + 1)
            .try_into()
            .map_err(|_| Error::InvalidQuery)?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(migration)?;
        transaction.pragma_update(None, "user_version", target_version)?;
        transaction.commit()?;
    }

    Ok(())
}
