import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db, { initializeDatabase } from './database';

initializeDatabase();

const users = [
  { id: uuidv4(), name: 'Admin', email: 'ceo@lyracore.com', password: 'ceo123', role: 'management' },
  { id: uuidv4(), name: 'Rajesh Kumar', email: 'sales1@lyracore.com', password: 'sales123', role: 'sales' },
  { id: uuidv4(), name: 'Priya Singh', email: 'sales2@lyracore.com', password: 'sales123', role: 'sales' },
  { id: uuidv4(), name: 'Amit Production', email: 'prod@lyracore.com', password: 'prod123', role: 'production' },
];

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (id, name, email, password_hash, role)
  VALUES (?, ?, ?, ?, ?)
`);

for (const user of users) {
  const hash = bcrypt.hashSync(user.password, 10);
  insertUser.run(user.id, user.name, user.email, hash, user.role);
  console.log(`Created user: ${user.email} / ${user.password} [${user.role}]`);
}

console.log('\nSeed completed. Login credentials:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('CEO:        ceo@lyracore.com   / ceo123');
console.log('Sales 1:    sales1@lyracore.com / sales123');
console.log('Sales 2:    sales2@lyracore.com / sales123');
console.log('Production: prod@lyracore.com  / prod123');
