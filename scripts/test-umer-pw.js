const bcrypt = require('bcrypt');
const umerHash = '$2b$10$yzsSgy39q/me4ii0Foc3kOhK9WqdQtOIBsc5H5aDX5DvV17lb5lbq';
const candidates = [
  'admin123', 'admin', 'umer', 'umer123', 'umer1234', 'umer@123', 'Umer@123', 'Umer123', 'Umer1234', 'Umer123!',
  'password', 'Password123', 'primeview', 'primeview123', 'Primeview123', 'Primeview123!', '12345678', '123456',
  'ChUmer123', 'chumer123', 'chumer', 'ChUmer', 'pakistan', 'pakistan123', 'Pakistan123', 'testing123'
];
async function test() {
  for (const c of candidates) {
    if (await bcrypt.compare(c, umerHash)) {
      console.log('FOUND Umer password:', c);
      return;
    }
  }
  console.log('Not in list');
}
test();
