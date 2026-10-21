const bcrypt = require('bcrypt');
const candidates = ['admin123', 'Password123!', '12345678', 'hassan123', 'umer123', 'admin', 'password'];
const hassanHash = '$2b$10$C9gkmSJP5vTYwDrh8w3h9Oqr1y8LyqOBXwXKMoOg7AfbVTrYL8I1i';
const umerHash = '$2b$10$yzsSgy39q/me4ii0Foc3kOhK9WqdQtOIBsc5H5aDX5DvV17lb5lbq';
const adminHash = '$2b$10$MHynJzsJncg6tGEEraNIbuRJI9Lypzq9z.vCMYqNZv.6eswAerHYO';

async function test() {
  for (const c of candidates) {
    if (await bcrypt.compare(c, hassanHash)) console.log('Hassan password:', c);
    if (await bcrypt.compare(c, umerHash)) console.log('Umer password:', c);
    if (await bcrypt.compare(c, adminHash)) console.log('Admin password:', c);
  }
}
test();
