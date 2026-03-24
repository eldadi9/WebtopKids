import 'dotenv/config';
import { createUser, findUserByPhone } from './users.mjs';
import { hashPassword } from './auth.mjs';

const args = process.argv.slice(2);
let name, phone, password, chatId;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name') name = args[++i];
  else if (args[i] === '--phone') phone = args[++i];
  else if (args[i] === '--password') password = args[++i];
  else if (args[i] === '--chatId') chatId = args[++i];
}

if (!name || !phone || !password) {
  console.error('Usage: node setup_admin.mjs --name <name> --phone <phone> --password <pass> [--chatId <chatId>]');
  process.exit(1);
}

if (findUserByPhone(phone)) {
  console.error(`Error: user with phone ${phone} already exists`);
  process.exit(1);
}

try {
  const passwordHash = await hashPassword(password);
  createUser({ name, phone, passwordHash, chatId: chatId || null, role: 'admin', status: 'active', children: [] });
  console.log(`✅ Admin created: ${name} (${phone})`);
} catch (err) {
  console.error('Failed to create admin:', err.message);
  process.exit(1);
}
