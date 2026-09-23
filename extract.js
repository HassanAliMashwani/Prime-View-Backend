const fs = require('fs');
function extract(file) {
  const content = fs.readFileSync(file, 'utf8');
  const match = content.match(/CREATE POLICY.*?"PlotStatusHistory"[\s\S]*?\);/g);
  console.log('--- ' + file + ' ---');
  if (match) match.forEach(m => console.log(m));
  else console.log('Not found');
}
extract('prisma/rls.sql');
extract('prisma/rls_updates.sql');
