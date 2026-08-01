require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/config/db');

async function main() {
  const [username, password, fullName] = process.argv.slice(2);
  if (!username || !password || !fullName) {
    console.error('Использование: node scripts/create-admin.js <username> <password> "<ФИО>"');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, "admin")',
    [username, passwordHash, fullName]
  );

  console.log(`Администратор "${username}" создан`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
