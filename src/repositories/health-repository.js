async function checkDatabase(pool) {
  const connection = await pool.getConnection();
  try {
    return true;
  } finally {
    connection.release();
  }
}

module.exports = { checkDatabase };
