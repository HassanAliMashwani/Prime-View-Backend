const fs = require('fs');

function fixFile(file) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/current_setting\('app\.current_session_id',\s*true\)\s*=\s*'system_sweep'/g, "current_setting('app.current_role', true) = 'system_sweep'");
  fs.writeFileSync(file, content);
  console.log('Fixed', file);
}

fixFile('prisma/rls.sql');
fixFile('prisma/rls_updates.sql');
